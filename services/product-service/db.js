const AWS = require('aws-sdk');

const dynamoDB = new AWS.DynamoDB({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
});

const docClient = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000',
});

const TABLE_NAME = 'Products';

const initDB = async () => {
  const params = {
    TableName: TABLE_NAME,
    KeySchema: [
      { AttributeName: 'id', KeyType: 'HASH' }, // Partition key
    ],
    AttributeDefinitions: [
      { AttributeName: 'id', AttributeType: 'S' },
    ],
    ProvisionedThroughput: {
      ReadCapacityUnits: 5,
      WriteCapacityUnits: 5,
    },
  };

  try {
    await dynamoDB.createTable(params).promise();
    console.log(`DynamoDB Table ${TABLE_NAME} created`);
  } catch (err) {
    if (err.code === 'ResourceInUseException') {
      console.log(`DynamoDB Table ${TABLE_NAME} already exists`);
    } else {
      console.error('Error creating DynamoDB table:', err);
    }
  }
};

module.exports = {
  docClient,
  initDB,
  TABLE_NAME,
};
