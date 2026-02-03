import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as rds from "aws-cdk-lib/aws-rds";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as path from "path";
import { Platform } from "aws-cdk-lib/aws-ecr-assets";

const MIN_HEALTHY_PERCENT = 50;

export class CdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // 1. VPC
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

    // 3. Event Bus
    const eventBus = new events.EventBus(this, "CloudRetailEventBus", {
      eventBusName: "CloudRetailBus",
    });

    new events.Archive(this, "EventArchive", {
      eventPattern: {
        account: [cdk.Stack.of(this).account],
      },
      sourceEventBus: eventBus,
      archiveName: "CloudRetailArchive",
      retention: cdk.Duration.days(7),
    });

    // JWT Secret
    const jwtSecret = new secretsmanager.Secret(this, "JwtSecret", {
      secretName: "CloudRetail/JwtSecret",
      description: "JWT signing secret for IAM service authentication",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ algorithm: "HS256" }),
        generateStringKey: "secret",
        excludePunctuation: true,
        passwordLength: 64,
      },
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

    // Lambda Layer for pg module
    const pgLayer = new lambda.LayerVersion(this, "PgLayer", {
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/db-init")),
      compatibleRuntimes: [lambda.Runtime.NODEJS_24_X],
      description: "PostgreSQL client library (pg)",
    });

    const dbInitRole = new iam.Role(this, "DbInitLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole",
        ),
      ],
    });

    dbInstance.secret!.grantRead(dbInitRole);

    const dbInitFunction = new lambda.Function(this, "DbInitFunction", {
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: "index.handler",
      code: lambda.Code.fromAsset(path.join(__dirname, "../lambda/db-init")),
      layers: [pgLayer],
      environment: {
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_SECRET_ARN: dbInstance.secret!.secretArn,
      },
      vpc: vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      timeout: cdk.Duration.minutes(5),
      role: dbInitRole,
    });

    const dbInitProvider = new cr.Provider(this, "DbInitProvider", {
      onEventHandler: dbInitFunction,
    });

    const dbInitCustomResource = new cdk.CustomResource(
      this,
      "DbInitCustomResource",
      {
        serviceToken: dbInitProvider.serviceToken,
        properties: {
          DbEndpoint: dbInstance.instanceEndpoint.hostname,
          Timestamp: Date.now(),
        },
      },
    );

    dbInitCustomResource.node.addDependency(dbInstance);

    // 5. Application Load Balancer
    const alb = new elbv2.ApplicationLoadBalancer(this, "CloudRetailALB", {
      vpc,
      internetFacing: true,
    });

    const listener = alb.addListener("HttpListener", {
      port: 80,
      open: true,
    });

    // Common task properties
    const commonTaskProps = { memoryLimitMiB: 512, cpu: 256 };

    // 6. IAM Service
    const iamTaskDef = new ecs.FargateTaskDefinition(
      this,
      "IamTaskDef",
      commonTaskProps,
    );
    iamTaskDef.addContainer("IamContainer", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../../services/iam-service"),
        { platform: Platform.LINUX_AMD64 },
      ),
      environment: {
        PORT: "80",
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_PORT: "5432",
        DB_NAME: "iam_db",
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "username",
        ),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "password",
        ),
        JWT_SECRET: ecs.Secret.fromSecretsManager(jwtSecret, "secret"),
      },
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "iam-service" }),
    });

    const iamService = new ecs.FargateService(this, "IamService", {
      cluster,
      taskDefinition: iamTaskDef,
      desiredCount: 1,
      minHealthyPercent: MIN_HEALTHY_PERCENT,
    });

    const iamTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "IamTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [iamService],
        healthCheck: {
          path: "/health",
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      },
    );

    listener.addTargetGroups("IamRouting", {
      targetGroups: [iamTargetGroup],
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(["/auth", "/auth/*"])],
    });

    // 7. Product Service
    const productTaskDef = new ecs.FargateTaskDefinition(
      this,
      "ProductTaskDef",
      commonTaskProps,
    );
    productTaskDef.addContainer("ProductContainer", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../../services/product-service"),
        { platform: Platform.LINUX_AMD64 },
      ),
      environment: {
        PORT: "80",
        AWS_REGION: this.region,
        TABLE_NAME: productTable.tableName,
      },
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "product-service" }),
    });

    productTable.grantReadWriteData(productTaskDef.taskRole);

    const productService = new ecs.FargateService(this, "ProductService", {
      cluster,
      taskDefinition: productTaskDef,
      desiredCount: 1,
      minHealthyPercent: MIN_HEALTHY_PERCENT,
    });

    const productTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "ProductTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [productService],
        healthCheck: {
          path: "/health",
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      },
    );

    listener.addTargetGroups("ProductRouting", {
      targetGroups: [productTargetGroup],
      priority: 20,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/products", "/products/*"]),
      ],
    });

    // 8. Order Service
    const orderTaskDef = new ecs.FargateTaskDefinition(
      this,
      "OrderTaskDef",
      commonTaskProps,
    );
    orderTaskDef.addContainer("OrderContainer", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../../services/order-service"),
        { platform: Platform.LINUX_AMD64 },
      ),
      environment: {
        PORT: "80",
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_PORT: "5432",
        DB_NAME: "order_db",
        PRODUCT_SERVICE_URL: `http://${alb.loadBalancerDnsName}`,
        EVENT_BUS_NAME: eventBus.eventBusName,
        AWS_REGION: this.region,
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "username",
        ),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "password",
        ),
      },
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "order-service" }),
    });

    eventBus.grantPutEventsTo(orderTaskDef.taskRole);

    const orderService = new ecs.FargateService(this, "OrderService", {
      cluster,
      taskDefinition: orderTaskDef,
      desiredCount: 1,
      minHealthyPercent: MIN_HEALTHY_PERCENT,
    });

    const orderTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "OrderTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [orderService],
        healthCheck: {
          path: "/health",
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      },
    );

    listener.addTargetGroups("OrderRouting", {
      targetGroups: [orderTargetGroup],
      priority: 30,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/orders", "/orders/*"]),
      ],
    });

    // 9. Inventory Service
    const inventoryTaskDef = new ecs.FargateTaskDefinition(
      this,
      "InventoryTaskDef",
      commonTaskProps,
    );
    inventoryTaskDef.addContainer("InventoryContainer", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../../services/inventory-service"),
        { platform: Platform.LINUX_AMD64 },
      ),
      environment: {
        PORT: "80",
        DB_HOST: dbInstance.instanceEndpoint.hostname,
        DB_PORT: "5432",
        DB_NAME: "inventory_db",
      },
      secrets: {
        DB_USERNAME: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "username",
        ),
        DB_PASSWORD: ecs.Secret.fromSecretsManager(
          dbInstance.secret!,
          "password",
        ),
      },
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "inventory-service" }),
    });

    const inventoryService = new ecs.FargateService(this, "InventoryService", {
      cluster,
      taskDefinition: inventoryTaskDef,
      desiredCount: 1,
      minHealthyPercent: MIN_HEALTHY_PERCENT,
    });

    const inventoryTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "InventoryTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [inventoryService],
        healthCheck: {
          path: "/health",
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      },
    );

    listener.addTargetGroups("InventoryRouting", {
      targetGroups: [inventoryTargetGroup],
      priority: 40,
      conditions: [
        elbv2.ListenerCondition.pathPatterns(["/inventory", "/inventory/*"]),
      ],
    });

    // Event-Driven: OrderCreated -> Inventory Service
    const inventoryWebhookHandler = new lambda.Function(
      this,
      "InventoryWebhookHandler",
      {
        runtime: lambda.Runtime.NODEJS_24_X,
        handler: "index.handler",
        code: lambda.Code.fromInline(`
          const http = require('http');
          exports.handler = async (event) => {
            console.log('Received event:', JSON.stringify(event, null, 2));
            const endpoint = process.env.INVENTORY_ENDPOINT;
            const url = new URL(endpoint);
            const data = JSON.stringify(event.detail);
            const options = {
              hostname: url.hostname,
              port: url.port || 80,
              path: url.pathname,
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': data.length
              }
            };
            return new Promise((resolve, reject) => {
              const req = http.request(options, (res) => {
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
          INVENTORY_ENDPOINT: `http://${alb.loadBalancerDnsName}/inventory/webhook/order-created`,
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

    // Database security
    dbInstance.connections.allowFrom(
      iamService.connections,
      ec2.Port.tcp(5432),
      "IAM Service to RDS",
    );
    dbInstance.connections.allowFrom(
      orderService.connections,
      ec2.Port.tcp(5432),
      "Order Service to RDS",
    );
    dbInstance.connections.allowFrom(
      inventoryService.connections,
      ec2.Port.tcp(5432),
      "Inventory Service to RDS",
    );
    dbInstance.connections.allowFrom(
      dbInitFunction,
      ec2.Port.tcp(5432),
      "DB Init Lambda to RDS",
    );

    // Add CloudFormation-level dependencies to ensure services wait for DB init
    // This avoids circular dependencies with security groups
    const cfnIamService = iamService.node.defaultChild as ecs.CfnService;
    const cfnOrderService = orderService.node.defaultChild as ecs.CfnService;
    const cfnInventoryService = inventoryService.node
      .defaultChild as ecs.CfnService;
    const cfnDbInit = dbInitCustomResource.node.defaultChild as cdk.CfnResource;

    cfnIamService.addDependency(cfnDbInit);
    cfnOrderService.addDependency(cfnDbInit);
    cfnInventoryService.addDependency(cfnDbInit);

    // 10. Frontend Service
    const frontendTaskDef = new ecs.FargateTaskDefinition(
      this,
      "FrontendTaskDef",
      commonTaskProps,
    );
    frontendTaskDef.addContainer("FrontendContainer", {
      image: ecs.ContainerImage.fromAsset(
        path.join(__dirname, "../../../frontend"),
        { platform: Platform.LINUX_AMD64 },
      ),
      environment: {
        VITE_IAM_API_URL: `http://${alb.loadBalancerDnsName}`,
        VITE_PRODUCT_API_URL: `http://${alb.loadBalancerDnsName}`,
        VITE_ORDER_API_URL: `http://${alb.loadBalancerDnsName}`,
      },
      portMappings: [{ containerPort: 80 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "frontend-service" }),
    });

    const frontendService = new ecs.FargateService(this, "FrontendService", {
      cluster,
      taskDefinition: frontendTaskDef,
      desiredCount: 1,
      minHealthyPercent: MIN_HEALTHY_PERCENT,
    });

    const frontendTargetGroup = new elbv2.ApplicationTargetGroup(
      this,
      "FrontendTargetGroup",
      {
        vpc,
        port: 80,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [frontendService],
        healthCheck: {
          path: "/",
          interval: cdk.Duration.seconds(60),
          timeout: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 5,
        },
      },
    );

    // Default action: route everything else to frontend
    listener.addTargetGroups("FrontendRouting", {
      targetGroups: [frontendTargetGroup],
    });

    new cdk.CfnOutput(this, "LoadBalancerUrl", {
      value: `http://${alb.loadBalancerDnsName}`,
    });
  }
}

