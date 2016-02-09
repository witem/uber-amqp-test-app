#!/usr/bin/env node
'use strict';
process.on( 'uncaughtException', function( e ) {
  console.error( e.stack || e );
});

var config = null;
try {
  config = require( '../config.json' );
} catch ( e ) {
  console.error( 'Not found config.json' );
  return;
}

var context = require( 'rabbit.js' ).createContext( config.amqp.connection_string );
var request = require( 'request' );

var worker_id = process.argv[2];
console.log( 'Worker id', worker_id );
context.on( 'ready', function() {
  var worker = context.socket( 'WORKER' );
  var res_worker = context.socket( 'PUB' );

  res_worker.connect( config.amqp.publisher_channel, function() {
    worker.connect( config.amqp.worker_channel, function() {
      worker.on( 'data', function( data ) {
        console.log( 'worker.data', Date.now() );
        var json;
        try {
          json = JSON.parse( data.toString() );
        } catch ( e ) {
          console.error( e );
          return;
        }
        get_products( json.data, function( err, body ) {
          var res_obj;
          if ( err ) {
            worker.requeue();
            return;
          }
          res_obj = {
            id : json.id,
            worker_id : worker_id,
            query : json.data
          };
          try {
            res_obj.data = JSON.parse( body );
          } catch ( e ) {
            worker.requeue();
            return;
          }
          worker.ack();
          res_worker.write( JSON.stringify( res_obj ), 'utf8' );
        });
      });
    });
  });
});

var get_products = function( data, cb ) {
  var req_obj = {
    method : 'GET',
    url : 'https://api.uber.com/v1/products',
    qs : {
      latitude : data.latitude,
      longitude : data.longitude
    },
    headers: {
      'Authorization': 'Token hfiyeL6nBjx5aTIFbv0L0kpeQssiCldtcxGFgUSU'
    }
  };

  request( req_obj, function( err, httpResponse, body ) {
    if ( err ) {
      console.error( err );
      cb( err );
      return;
    }
    if ( +httpResponse.statusCode !== 200 ) {
      console.log( 'BAD STATUS CODE:', Date.now() );
      console.log( httpResponse.statusCode );
      console.log( 'BODY', body );
      cb( new Error( 'Bad statusCode: ' + httpResponse.statusCode ) );
      return;
    }
    cb( null, body );
  });
};
