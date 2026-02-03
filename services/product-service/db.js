const AWS = require("aws-sdk");

// Only use endpoint override if explicitly set (for local development)
const dynamoConfig = {
  region: process.env.AWS_REGION || "us-east-1",
};

// Only add endpoint if explicitly set (local development with DynamoDB Local)
if (process.env.DYNAMODB_ENDPOINT) {
  dynamoConfig.endpoint = process.env.DYNAMODB_ENDPOINT;
}

const dynamoDB = new AWS.DynamoDB(dynamoConfig);
const docClient = new AWS.DynamoDB.DocumentClient(dynamoConfig);

// Use environment variable for table name (set by CDK in production)
const TABLE_NAME = process.env.TABLE_NAME || "Products";

const initDB = async () => {
  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: "id", KeyType: "HASH" }, // Partition key
    ],
    AttributeDefinitions: [{ AttributeName: "id", AttributeType: "S" }],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  };

  try {
    await dynamoDB.deleteTable({ TableName: TABLE_NAME }).promise();
    await dynamoDB.createTable(params).promise();
    console.log(`DynamoDB Table ${TABLE_NAME} created`);
  } catch (err) {
    if (err.code === "ResourceInUseException") {
      console.log(`DynamoDB Table ${TABLE_NAME} already exists`);
    } else {
      console.error("Error creating DynamoDB table:", err);
    }
  }
};

module.exports = {
  docClient,
  initDB,
  TABLE_NAME,
};

