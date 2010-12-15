var path = require('path'),
    fs = require('fs');

module.exports = {
    ensureDirExists: function(filename, cb) {

        function iterate(parts, i) {
            if (i < parts.length) {
                recurse(parts, i+1);
            }
            else {
                cb(null, true);
            }
        }
        
        function recurse(parts, i) {
            var dir = parts.slice(0,i+1).join('/');
            path.exists(dir, function(exists) {
                if (!exists) {
                    fs.mkdir(dir, 0755, function(err, rsp) {
                        if (err && err.errno != 17) { // 17 is EEXIST, no problem
                            cb(err, false);
                        }
                        else {
                            iterate(parts, i);
                        }
                    });
                }
                else {
                    iterate(parts, i);
                }
            })
        }
    
        var folder = path.dirname(path.normalize(filename));
        recurse(folder.split('/'), 0);
    }
}