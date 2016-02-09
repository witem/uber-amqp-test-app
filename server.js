#!/usr/bin/env node
'use strict';
process.on( 'uncaughtException', function( e ) {
  console.error( e.stack || e );
});

var ECT = require( 'ect' );
var path = require( 'path' );
var Primus = require( 'primus' );
var express = require( 'express' );
var session = require( 'express-session' );
var twitterAPI = require( 'node-twitter-api' );
var cookie_parser = require( 'cookie-parser' );

var server_port = process.env.PORT || 8080;

var config = null;
try {
  config = require( './config.json' );
} catch ( e ) {
  console.error( 'Not found config.json' );
  return;
}

// Get your credentials here: https://dev.twitter.com/apps
var twitter = new twitterAPI( config.twitterAPI );

var _requestSecret;
var ectRenderer = ECT({
  watch: true,
  root: __dirname + '/views',
  ext : '.ect'
});
var session_middleware = session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: true
  // cookie: { maxAge: 60000 }
});

/*
 *  SERVER
 */
var app = express();
var server = require( 'http' ).createServer( app );

app.set( 'view engine', 'ect' );
app.engine( 'ect', ectRenderer.render );
app.use( express['static']( path.join( __dirname, 'public' ) ) );
app.use( cookie_parser() );
app.use( session_middleware );

app.get( '/', function( req, res ) {
  if ( req.session.accessToken && req.session.accessSecret ) {
    twitter.verifyCredentials( req.session.accessToken, req.session.accessSecret, function( err, user ) {
      if ( err ) {
        res.render( 'login' );
      } else {
        res.render( 'home', user );
      }
    });
  } else {
    res.render( 'login' );
  }
});

app.get( '/sessions/connect', function( req, res ) {
  twitter.getRequestToken( function( err, requestToken, requestSecret ) {
    if ( err ) {
      console.error( 'Error getting OAuth request token :', err );
      res.status( 500 ).send( 'Error getting OAuth request token.' );
    } else {
      //store token and tokenSecret somewhere, you'll need them later; redirect user
      _requestSecret = requestSecret;
      res.redirect( 'https://api.twitter.com/oauth/authenticate?oauth_token=' + requestToken );
    }
  });
});

app.get( '/sessions/callback', function( req, res ) {
  var requestToken = req.query.oauth_token,
    verifier = req.query.oauth_verifier;

  twitter.getAccessToken( requestToken, _requestSecret, verifier, function( err, accessToken, accessSecret ) {
    if ( err ) {
      console.error( 'Error getting OAuth access token :', err );
      res.status( 500 ).send( 'Error getting OAuth access token.' );
    } else {
      twitter.verifyCredentials( accessToken, accessSecret, function( err, user ) {
        if ( err ) {
          console.error( 'Error verify credentials :', err );
          res.status( 500 ).send( 'Error verify credentials' );
        } else {
          req.session.accessToken = accessToken;
          req.session.accessSecret = accessSecret;
          res.redirect( '/' );
        }
      });
    }
  });
});


app.get( '/logout', function( req, res ) {
  req.session.destroy();
  res.redirect( '/' );
});


app.use( function( req, res ) {
  return res.status( 404 ).send( '<p>Sorry, we cannot find that!</p><a href="/">Go home</a>' );
});
app.use( function( error, req, res ) {
  return res.status( 500 ).send({
    error: 'something blew up'
  });
});
server.listen( server_port );
console.log( 'Server listen on port: ' + server_port );

var primus = new Primus( server, {
  transformer: 'websockets'
});

primus.on( 'connection', function( spark ) {
  spark.on( 'data', function( data ) {
    var ac_t = this.request.session.accessToken,
      ac_s = this.request.session.accessSecret;
    switch ( data['switch'] ) {
      case '/api/v1/check_login':
        twitter.verifyCredentials( ac_t, ac_s, function( err, user ) {
          if ( err ) {
            spark.write({
              'switch' : 'error',
              message : 'Not login!'
            });
          } else {
            spark.write({
              'switch' : 'status',
              message : 'Logined'
            });
          }
        });
        break;
      case '/api/v1/logout':
        this.request.session.destroy( function( err ) {
          if ( err ) {
            spark.write({
              'switch' : 'error',
              message : 'Error on logout.'
            });
          } else {
            spark.write({
              'switch' : 'status',
              message : 'Logout successful.'
            });
          }
        });
        break;
      case '/api/v1/uber_request' :
        twitter.verifyCredentials( ac_t, ac_s, function( err, user ) {
          if ( err ) {
            spark.write({
              'switch' : 'error',
              message : 'Not login!'
            });
          } else {
            if ( !isNaN( +data.latitude ) && !isNaN( +data.longitude ) ) {
              send_to_worker({
                latitude : data.latitude,
                longitude : data.longitude
              }, spark );
            }
          }
        });
        break;
      default:
        console.error( 'wrong switch', data );
    }
  });
});

primus.save( __dirname + '/public/primus.js' );
primus.before( 'cookies', cookie_parser() );
primus.before( 'session', session_middleware );

/*
* RabbitMQ
 */
var context = null;
var send = null;
var id_to_socket = {};

var init_rabbitmq = function( cb ) {
  context = require( 'rabbit.js' ).createContext( config.amqp.connection_string );

  context.on( 'ready', function() {
    send = context.socket( 'PUSH' );
    var res_worker = context.socket( 'SUB' );

    send.connect( config.amqp.worker_channel, cb );
    res_worker.connect( config.amqp.publisher_channel, function( data ) {
      res_worker.on( 'data', function( data ) {
        var json;
        try {
          json = JSON.parse( data.toString() );
        } catch ( e ) {
          console.error( e );
          return;
        }
        if ( id_to_socket[json.id] != null ) {
          id_to_socket[json.id].write({
            'switch' : 'uber_response',
            worker_id : json.worker_id,
            data : json.data,
            query : json.query
          });//TODO need use user_id broadcast
          delete id_to_socket[json.id];
        }
      });
    });
  });

  context.on( 'error', function( err ) {
    console.error( err );
    context = null;
    send = null;
  });

  context.on( 'close', function( err ) {
    console.error( 'context close' );
    context = null;
    send = null;
  });
};

var generate_id = function() {
  var first = Math.random().toString( 36 ).slice( 2 );//TODO need use crypto pseudorandom
  var second = Date.now();
  return ( first + '_' + second );
};

var send_to_worker = function( data, socket ) {
  var id = generate_id();
  var to_wroker = JSON.stringify({
    id : id,
    data : data
  });

  if ( !context ) {
    init_rabbitmq( function() {
      send.write( to_wroker, 'utf8' );
      id_to_socket[id] = socket;
    });
  } else {
    send.write( to_wroker, 'utf8' );
    id_to_socket[id] = socket;
  }
};
