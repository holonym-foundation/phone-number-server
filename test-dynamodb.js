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


// get an item: ddb.getItem(getNumberParams('+13109273149'), (e,d)=>console.log("er",e,"data",d))
// put an item:
ddb.putItem(putNumberParams('deleteme'), (e,d,)=>console.log("er",e,"data",d))
// ddb.listTables({}, (err,data)=>console.log("err",err,"data",data));
