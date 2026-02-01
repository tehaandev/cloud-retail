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
import * as cr from "aws-cdk-lib/custom-resources";
import * as iam from "aws-cdk-lib/aws-iam";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
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

    // JWT Secret for IAM Service
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
      compatibleRuntimes: [lambda.Runtime.NODEJS_18_X],
      description: "PostgreSQL client library (pg)",
    });

    // Lambda Execution Role
    const dbInitRole = new iam.Role(this, "DbInitLambdaRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "service-role/AWSLambdaVPCAccessExecutionRole",
        ),
      ],
    });

    dbInstance.secret!.grantRead(dbInitRole);

    // Lambda Function for Database Initialization
    const dbInitFunction = new lambda.Function(this, "DbInitFunction", {
      runtime: lambda.Runtime.NODEJS_18_X,
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

    // Custom Resource Provider
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
          containerPort: 80,
        },
        ...commonTaskProps,
        healthCheckGracePeriod: cdk.Duration.seconds(300),
      },
    );

    iamService.targetGroup.configureHealthCheck({
      path: "/health",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

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
          healthCheckGracePeriod: cdk.Duration.seconds(300),
        },
      );

    productService.targetGroup.configureHealthCheck({
      path: "/health",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

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
            { platform: Platform.LINUX_AMD64 },
          ),
          environment: {
            PORT: "80",
            DB_HOST: dbInstance.instanceEndpoint.hostname,
            DB_PORT: "5432",
            DB_NAME: "order_db",
            PRODUCT_SERVICE_URL: `http://${productService.loadBalancer.loadBalancerDnsName}`,
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
          containerPort: 80,
        },
        ...commonTaskProps,
        healthCheckGracePeriod: cdk.Duration.seconds(300),
      },
    );

    orderService.targetGroup.configureHealthCheck({
      path: "/health",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

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
            containerPort: 80,
          },
          ...commonTaskProps,
          healthCheckGracePeriod: cdk.Duration.seconds(300),
        },
      );

    inventoryService.targetGroup.configureHealthCheck({
      path: "/health",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

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

    // Secure database access - only allow from specific services
    dbInstance.connections.allowFrom(
      iamService.service.connections,
      ec2.Port.tcp(5432),
      "IAM Service to RDS",
    );
    dbInstance.connections.allowFrom(
      orderService.service.connections,
      ec2.Port.tcp(5432),
      "Order Service to RDS",
    );
    dbInstance.connections.allowFrom(
      inventoryService.service.connections,
      ec2.Port.tcp(5432),
      "Inventory Service to RDS",
    );
    dbInstance.connections.allowFrom(
      dbInitFunction,
      ec2.Port.tcp(5432),
      "DB Init Lambda to RDS",
    );

    // 6. API Gateway
    const api = new apigateway.RestApi(this, "CloudRetailApi", {
      restApiName: "CloudRetail Service",
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
      },
    });

    // IAM Service Routes
    const auth = api.root.addResource("auth");
    auth.addProxy({
      defaultIntegration: new apigateway.HttpIntegration(
        `http://${iamService.loadBalancer.loadBalancerDnsName}/auth/{proxy}`,
        {
          proxy: true,
        },
      ),
      anyMethod: true,
    });

    // Product Service Routes
    const products = api.root.addResource("products");
    const productsIntegration = new apigateway.HttpIntegration(
      `http://${productService.loadBalancer.loadBalancerDnsName}/products`,
      {
        proxy: true,
      },
    );
    const productsProxyIntegration = new apigateway.HttpIntegration(
      `http://${productService.loadBalancer.loadBalancerDnsName}/products/{proxy}`,
      {
        proxy: true,
      },
    );
    products.addMethod("ANY", productsIntegration);
    products.addProxy({
      defaultIntegration: productsProxyIntegration,
      anyMethod: true,
    });

    // Order Service Routes
    const orders = api.root.addResource("orders");
    const ordersIntegration = new apigateway.HttpIntegration(
      `http://${orderService.loadBalancer.loadBalancerDnsName}/orders`,
      {
        proxy: true,
      },
    );
    orders.addMethod("ANY", ordersIntegration);
    orders.addProxy({
      defaultIntegration: new apigateway.HttpIntegration(
        `http://${orderService.loadBalancer.loadBalancerDnsName}/orders/{proxy}`,
        {
          proxy: true,
        },
      ),
      anyMethod: true,
    });

    // Inventory Service Routes
    const inventory = api.root.addResource("inventory");
    inventory.addProxy({
      defaultIntegration: new apigateway.HttpIntegration(
        `http://${inventoryService.loadBalancer.loadBalancerDnsName}/inventory/{proxy}`,
        {
          proxy: true,
        },
      ),
      anyMethod: true,
    });

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
              VITE_IAM_API_URL: `${api.url}`,
              VITE_PRODUCT_API_URL: `${api.url}`,
              VITE_ORDER_API_URL: `${api.url}`,
            },

            containerPort: 80,
          },
          ...commonTaskProps,
          healthCheckGracePeriod: cdk.Duration.seconds(300),
        },
      );

    frontendService.targetGroup.configureHealthCheck({
      path: "/",
      interval: cdk.Duration.seconds(60),
      timeout: cdk.Duration.seconds(30),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    new cdk.CfnOutput(this, "ApiUrl", { value: api.url });
    new cdk.CfnOutput(this, "FrontendUrl", {
      value: `http://${frontendService.loadBalancer.loadBalancerDnsName}`,
    });
  }
}

