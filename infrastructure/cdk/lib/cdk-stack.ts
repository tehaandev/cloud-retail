import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as ecs_patterns from "aws-cdk-lib/aws-ecs-patterns";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as rds from "aws-cdk-lib/aws-rds";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as logs from "aws-cdk-lib/aws-logs";
import * as path from "path";

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC (Virtual Private Cloud)
    const vpc = new ec2.Vpc(this, "CloudRetailVpc", {
      maxAzs: 2,
      natGateways: 1,
    });

    // 2. ECS Cluster
    const cluster = new ecs.Cluster(this, "CloudRetailCluster", {
      vpc: vpc,
    });

    // 3. Event Bus (Event-Driven Architecture)
    const eventBus = new events.EventBus(this, "CloudRetailEventBus", {
      eventBusName: "CloudRetailBus",
    });

    // Archive all events for debugging/audit
    new events.Archive(this, "EventArchive", {
      eventPattern: {
        account: [cdk.Stack.of(this).account],
      },
      sourceEventBus: eventBus,
      archiveName: "CloudRetailArchive",
      retention: cdk.Duration.days(7),
    });

    // 4. Databases
    const productTable = new dynamodb.Table(this, "ProductsTable", {
      partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const dbInstance = new rds.DatabaseInstance(this, "CloudRetailDB", {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_18_1,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MICRO,
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      databaseName: "cloudretail",
    });
    dbInstance.connections.allowFromAnyIpv4(
      ec2.Port.tcp(5432),
      "Allow App access to DB",
    );

    // 5. Microservices (Fargate)
    const commonTaskProps = { memoryLimitMiB: 512, cpu: 256 };

    // IAM Service
    const iamService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "IamService",
      {
        cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "../../../services/iam-service"),
          ),
          environment: {
            PORT: "80",
            DATABASE_URL: `postgres://${dbInstance.instanceEndpoint.hostname}:5432/iam_db`,
            JWT_SECRET: "supersecretkey",
          },
          containerPort: 80,
        },
        ...commonTaskProps,
      },
    );

    // Product Service
    const productService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "ProductService",
        {
          cluster,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../services/product-service"),
            ),
            environment: {
              PORT: "80",
              AWS_REGION: this.region,
              TABLE_NAME: productTable.tableName,
            },
            containerPort: 80,
          },
          ...commonTaskProps,
        },
      );
    productTable.grantReadWriteData(productService.taskDefinition.taskRole);

    // Order Service
    const orderService = new ecs_patterns.ApplicationLoadBalancedFargateService(
      this,
      "OrderService",
      {
        cluster,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "../../../services/order-service"),
          ),
          environment: {
            PORT: "80",
            DATABASE_URL: `postgres://${dbInstance.instanceEndpoint.hostname}:5432/order_db`,
            PRODUCT_SERVICE_URL: `http://${productService.loadBalancer.loadBalancerDnsName}`,
            EVENT_BUS_NAME: eventBus.eventBusName, // Pass bus name
          },
          containerPort: 80,
        },
        ...commonTaskProps,
      },
    );
    eventBus.grantPutEventsTo(orderService.taskDefinition.taskRole);

    // Inventory Service
    const inventoryService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "InventoryService",
        {
          cluster,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../services/inventory-service"),
            ),
            environment: {
              PORT: "80",
              DATABASE_URL: `postgres://${dbInstance.instanceEndpoint.hostname}:5432/inventory_db`,
            },
            containerPort: 80,
          },
          ...commonTaskProps,
        },
      );

    // Event-Driven Loop: OrderCreated -> Inventory Service (WebHook)
    // In a real AWS environment, we use an API Destination to call our service internal ALB
    const apiDestination = new events.ApiDestination(
      this,
      "InventoryApiDestination",
      {
        connection: new events.Connection(this, "InventoryConnection", {
          authorization: events.Authorization.apiKey(
            "x-api-key",
            cdk.SecretValue.unsafePlainText("unused"),
          ), // Dummy for internal
        }),
        endpoint: `http://${inventoryService.loadBalancer.loadBalancerDnsName}/inventory/webhook/order-created`,
        description: "Send OrderCreated events to Inventory Service",
        httpMethod: events.HttpMethod.POST,
      },
    );

    new events.Rule(this, "OrderCreatedRule", {
      eventBus,
      eventPattern: {
        source: ["com.cloudretail.order"],
        detailType: ["OrderCreated"],
      },
      targets: [new targets.ApiDestination(apiDestination)],
    });

    // 6. API Gateway
    const api = new apigateway.RestApi(this, "CloudRetailApi", {
      restApiName: "CloudRetail Service",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    const iamIntegration = new apigateway.HttpIntegration(
      `http://${iamService.loadBalancer.loadBalancerDnsName}/`,
    );
    const productIntegration = new apigateway.HttpIntegration(
      `http://${productService.loadBalancer.loadBalancerDnsName}/`,
    );
    const orderIntegration = new apigateway.HttpIntegration(
      `http://${orderService.loadBalancer.loadBalancerDnsName}/`,
    );
    const inventoryIntegration = new apigateway.HttpIntegration(
      `http://${inventoryService.loadBalancer.loadBalancerDnsName}/`,
    );

    api.root
      .addResource("auth")
      .addProxy({ defaultIntegration: iamIntegration });

    const products = api.root.addResource("products");
    products.addMethod("GET", productIntegration);
    products.addMethod("POST", productIntegration);
    products.addResource("{id}").addMethod("GET", productIntegration);

    api.root
      .addResource("orders")
      .addProxy({ defaultIntegration: orderIntegration });
    api.root
      .addResource("inventory")
      .addProxy({ defaultIntegration: inventoryIntegration });

    // Frontend Service (created after API Gateway so we can reference api.url)
    const frontendService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "FrontendService",
        {
          cluster,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../frontend"),
              {
                buildArgs: {
                  VITE_IAM_API_URL: api.url + "auth",
                  VITE_PRODUCT_API_URL: api.url + "products",
                  VITE_ORDER_API_URL: api.url + "orders",
                },
              },
            ),
            containerPort: 80,
          },
          ...commonTaskProps,
        },
      );

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `http://${frontendService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}

