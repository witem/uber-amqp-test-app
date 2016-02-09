/*eslint-env browser */
/*global Primus*/
'use strict';

var insert_status = function( error, msg ) {
  if ( error ) {
    document.getElementById( 'res_status' ).classList.add( 'error' );
  } else {
    document.getElementById( 'res_status' ).classList.remove( 'error' );
  }
  document.getElementById( 'res_status' ).textContent = msg;
};

var insert_response = function( response ) {
  var temp, _item;
  var res_div = document.getElementById( 'response' );
  for ( var i = 0, len = response.data.products.length; i < len; i++ ) {
    _item = response.data.products[i];
    console.log( response.worker_id, i, _item );
    temp =  document.createElement( 'p' );
    temp.innerHTML = 'Name: ' + _item.display_name +
      '<br>Description: ' + _item.description;
    res_div.insertBefore( temp, res_div.childNodes[0] || null );
  }
  var query = document.createElement( 'h4' );
  query.innerHTML = 'Response from worker ID: "' + response.worker_id + '"<br>Query:' +
    JSON.stringify( response.query );
  res_div.insertBefore( query, res_div.childNodes[0] || null );
};

var primus = new Primus();

primus.on( 'open', function() {
  console.log( 'Connected!' );
});

primus.on( 'data', function( data ) {
  switch ( data.switch ) {
    case 'error' :
      insert_status( true, data.message );
      break;
    case 'status' :
      insert_status( false, data.message );
      break;
    case 'uber_response' :
      insert_response( data );
      break;
    default :
      console.error( 'NOT DEFINED RESPONSE', data );
  }
});

var login_button = document.getElementById( 'sign_in_with_twitter' );
if ( login_button ) {
  login_button.addEventListener( 'click', function( event ) {
    event.preventDefault();
    window.location.href = '/sessions/connect';
  });
}

var form = document.getElementById( 'search_form' );
if ( form ) {
  form.addEventListener( 'submit', function( event ) {
    event.preventDefault();
    primus.write({
      'switch' : '/api/v1/uber_request',
      'latitude' : this.elements.latitude.value,
      'longitude' : this.elements.longitude.value,
    });
  });
}
