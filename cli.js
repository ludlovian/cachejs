inspect = require('util').inspect;

global.callback = function(){
    var a = Array.from(arguments), n=0;
    console.log('callback called with %d args', a.length);
    for(x of a) {
        console.log(" %d => %s", n++, inspect(x, {colors:true}));
    }
};

global.Path = require('pathlib');

require('pixpromise');
