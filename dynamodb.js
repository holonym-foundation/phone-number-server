var AWS = require('aws-sdk');
AWS.config.update({region:'us-east-2'});
var ddb = new AWS.DynamoDB({apiVersion: '2012-08-10'});

// Helper function to get a phone number from the db
const getNumberParams = (value) => ({
	TableName: 'phone-numbers',
	Key: {'phoneNumber':{S:`${value}`}}
})

// Helper function to insert a phone number into  the db
const putNumberParams = (value) => ({
        TableName: 'phone-numbers',
        Item: {'phoneNumber':{S:`${value}`}}
})

// Returns true if number exists, false otherwise
const numberExists = (number, callback) => ddb.getItem(getNumberParams(number), (err,data)=>callback(err, "Item" in data))

// Adds number to the db
const addNumber = (number) => ddb.putItem(putNumberParams(number), (err)=>{if(err) throw 'Error storing number'})

// Usage: 
// addNumber('+1234567890')
// numberExists('+1234567890', (x)=>console.log('this should now be true', x))

module.exports = {addNumber:addNumber, numberExists:numberExists}

