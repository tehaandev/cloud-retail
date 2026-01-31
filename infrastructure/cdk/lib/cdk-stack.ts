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
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as path from "path";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";

const MIN_HEALTHY_PERCENT = 50;

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC (Virtual Private Cloud)
    const vpc = new ec2.Vpc(this, "CloudRetailVpc", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
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
        desiredCount: 1,
        minHealthyPercent: MIN_HEALTHY_PERCENT,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "../../../services/iam-service"),
            {
              platform: Platform.LINUX_AMD64,
            },
          ),
          environment: {
            PORT: "80",
            DATABASE_URL: `postgres://${dbInstance.secret?.secretValueFromJson("username").unsafeUnwrap()}:${dbInstance.secret?.secretValueFromJson("password").unsafeUnwrap()}@${dbInstance.instanceEndpoint.hostname}:5432/cloudretail`,
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
          desiredCount: 1,
          minHealthyPercent: MIN_HEALTHY_PERCENT,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../services/product-service"),
              {
                platform: Platform.LINUX_AMD64,
              },
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
        desiredCount: 1,
        minHealthyPercent: MIN_HEALTHY_PERCENT,
        taskImageOptions: {
          image: ecs.ContainerImage.fromAsset(
            path.join(__dirname, "../../../services/order-service"),
            {
              platform: Platform.LINUX_AMD64,
            },
          ),
          environment: {
            PORT: "80",
            DATABASE_URL: `postgres://${dbInstance.secret?.secretValueFromJson("username").unsafeUnwrap()}:${dbInstance.secret?.secretValueFromJson("password").unsafeUnwrap()}@${dbInstance.instanceEndpoint.hostname}:5432/cloudretail`,
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
          desiredCount: 1,
          minHealthyPercent: MIN_HEALTHY_PERCENT,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../services/inventory-service"),
              {
                platform: Platform.LINUX_AMD64,
              },
            ),
            environment: {
              PORT: "80",
              DATABASE_URL: `postgres://${dbInstance.secret?.secretValueFromJson("username").unsafeUnwrap()}:${dbInstance.secret?.secretValueFromJson("password").unsafeUnwrap()}@${dbInstance.instanceEndpoint.hostname}:5432/cloudretail`,
            },
            containerPort: 80,
          },
          ...commonTaskProps,
        },
      );

    // Event-Driven Loop: OrderCreated -> Inventory Service (WebHook)
    // Use Lambda function to forward events to internal HTTP endpoint
    // This avoids the HTTPS requirement of API Destinations
    const inventoryWebhookHandler = new lambda.Function(
      this,
      "InventoryWebhookHandler",
      {
        runtime: lambda.Runtime.NODEJS_18_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
          const https = require('https');
          const http = require('http');

          exports.handler = async (event) => {
            console.log('Received event:', JSON.stringify(event, null, 2));
            
            const endpoint = process.env.INVENTORY_ENDPOINT;
            const url = new URL(endpoint);
            const client = url.protocol === 'https:' ? https : http;
            
            const data = JSON.stringify(event.detail);
            
            const options = {
              hostname: url.hostname,
              port: url.port || (url.protocol === 'https:' ? 443 : 80),
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
              }
            };
            
            return new Promise((resolve, reject) => {
              const req = client.request(options, (res) => {
                let body = '';
                res.on('data', (chunk) => body += chunk);
                res.on('end', () => {
                  console.log('Response:', body);
                  resolve({ statusCode: res.statusCode, body });
                });
              });
              
              req.on('error', (error) => {
                console.error('Error:', error);
                reject(error);
              });
              
              req.write(data);
              req.end();
            });
          };
        `),
        environment: {
          INVENTORY_ENDPOINT: `http://${inventoryService.loadBalancer.loadBalancerDnsName}/inventory/webhook/order-created`,
        },
        vpc: vpc,
        timeout: cdk.Duration.seconds(30),
      },
    );

    new events.Rule(this, "OrderCreatedRule", {
      eventBus,
      eventPattern: {
        source: ["com.cloudretail.order"],
        detailType: ["OrderCreated"],
      },
      targets: [new targets.LambdaFunction(inventoryWebhookHandler)],
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
    // API URLs are passed as runtime environment variables (not build args)
    // The entrypoint.sh script generates env-config.js with these values
    const frontendService =
      new ecs_patterns.ApplicationLoadBalancedFargateService(
        this,
        "FrontendService",
        {
          cluster,
          desiredCount: 1,
          minHealthyPercent: MIN_HEALTHY_PERCENT,
          taskImageOptions: {
            image: ecs.ContainerImage.fromAsset(
              path.join(__dirname, "../../../frontend"),
              {
                platform: Platform.LINUX_AMD64,
              },
            ),
            environment: {
              VITE_IAM_API_URL: `${api.url}auth`,
              VITE_PRODUCT_API_URL: `${api.url}products`,
              VITE_ORDER_API_URL: `${api.url}orders`,
            },

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

