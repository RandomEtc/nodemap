// node.js geo polygon map tile rendering!
// requires https://github.com/learnboost/node-canvas and GeoJSON data files
// e.g. 
// data from naturalearthdata.com converted to GeoJSON with GDAL's ogr2ogr
// or from datasf.org, reprojected too:
// ogr2ogr -f GeoJSON sfbay.js sfbay.shp -t_srs EPSG:4326

var Canvas = require('canvas'),
    http = require('http'),
    url = require('url'),
    fs = require('fs');
    
var project = {
    'FeatureCollection': function(fc) { fc.features.forEach(project.Feature); },
    'Feature': function(f) { project[f.geometry.type](f.geometry.coordinates); },
    'MultiPolygon': function(mp) { mp.forEach(project.Polygon); },    
    'Polygon': function(p) { p.forEach(project.LineString); },
    'MultiLineString': function(ml) { ml.forEach(project.LineString); },
    'LineString': function(l) { l.forEach(project.Point); },
    'MultiPoint': function(mp) { mp.forEach(project.Point); },    
    'Point': function(c) {
        c[0] = 256.0 * (c[0] + 180) / 360.0;
        c[1] = 256.0 - 256.0 * (Math.PI + Math.log(Math.tan(Math.PI/4+c[1]*(Math.PI/180)/2))) / (2*Math.PI);
    }
}

function Layer(filename, styles) {
    //var data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    var raw = fs.readFileSync(filename, 'utf8');
    console.log('loaded raw data for', filename);
    var data = eval('('+raw+')');
    console.log('parsed', filename);
    data.styles = styles;
    return data;
}

console.log('loading layers...');
/*var bgColor = '#ffffee';
var layers = [ 
//    Layer('./datasf/phys_contours_wgs.js', [ { strokeStyle: '#aaa', lineWidth: 1.0 } ])
    Layer('./datasf/sfbay.js', [ { fillStyle: '#ddddff' } ]),
    Layer('./datasf/sflnds_parks.js', [ { fillStyle: '#ddffdd' } ]),
    Layer('./datasf/phys_waterbodies.js', [ { fillStyle: '#ddddff' } ]),
    Layer('./datasf/StClines.js', [ { strokeStyle: '#aaa', lineWidth: 1.0 } ]) 
];*/
var bgColor = '#ddddff';
var layers = [
    Layer('./naturalearthdata/10m_land.js', [ { fillStyle: '#ffffee' } ]),
    Layer('./naturalearthdata/10m_glaciated_areas.js', [ { fillStyle: '#ffffff' } ]),
    Layer('./naturalearthdata/10m_rivers_lake_centerlines.js', [ { strokeStyle: '#ddddff' } ]),
    Layer('./naturalearthdata/10m_lakes.js', [ { fillStyle: '#ddddff' } ]),
    Layer('./naturalearthdata/10m_us_parks_area.js', [ { fillStyle: '#ddffdd' } ]),
    Layer('./naturalearthdata/10m-urban-area.js', [ { fillStyle: '#eeeedd' } ]),
    Layer('./naturalearthdata/10m_railroads.js', [ { strokeStyle: '#777777' } ]),
    Layer('./naturalearthdata/10m_roads.js', [ { strokeStyle: '#aa8888' } ])
// TODO more boundaries from http://www.naturalearthdata.com/downloads/10m-cultural-vectors/
//    Layer('./naturalearthdata/10m_geography_regions_polys.js', [ { strokeStyle: 'rgba(0,0,0,0.2)' } ]),    
//    Layer('./naturalearthdata/10m_populated_places_simple.js', [ { fillStyle: '#ffffee' } ]),
//    Layer('./naturalearthdata/10m_roads_north_america.js', [ { strokeStyle: '#888888' } ])
];
console.log('done loading');

console.log('projecting features...');
var t = +new Date
layers.forEach(project.FeatureCollection);
console.log('done projecting in', new Date - t, 'ms'); 

function serveFile(filename, req, res) {
  fs.readFile(filename, "binary", function(err, file) {
    if(err) {
      res.writeHead(500, {"Content-Type": "text/plain"});
      res.write(err + "\n");
      res.end();
      return;
    }
    var suffix = filename.split('.').pop();
    var contentTypes = { "html": "text/html", "js": "application/x-javascript" };
    if (suffix in contentTypes) {
      res.writeHead(200, { "Content-Type": contentTypes[suffix] });
      res.end(file, "utf8");
    }
    else {
      res.writeHead(200);
      res.end(file, "binary");
    }
  });
}

function tile(req, res) {

    var path = url.parse(req.url).pathname;
    if (path == '/' || path == '/index.html') {
      serveFile('index.html', req, res);
      return;
    }
    else if (path == '/modestmaps.js') {
      serveFile('modestmaps.js', req, res);
      return;
    }

    var d = new Date();
    
    var coord = req.url.match(/(\d+)/g);
    if (!coord || coord.length != 3) {
        console.error(req.url, 'not a coord, match =', coord);
        res.writeHead(404);
        res.end();
        return;
    }
    
    coord = coord.map(Number);
    //console.log('got coord', coord);

    var canvas = new Canvas(256,256),
        ctx = canvas.getContext('2d');
    
    ctx.fillStyle = bgColor;
    ctx.fillRect(0,0,256,256);
    
    renderData(ctx, coord[0], coord[1], coord[2], function() {
        console.log('rendering done in', new Date - d, 'ms');
        d = new Date();
    
        // I've messed around with all kinds of "clever" ways to make this faster
        // but the nice truth is it takes about <20ms to write out the buffer
        // once renderData has finished, so why worry about it being synchronous?
        res.writeHead(200, {'Content-Type': 'image/png'});    
        res.end(canvas.toBuffer());
        console.log('streaming done in', new Date - d, 'ms');
    });
}

// NB:- these functions are called using 'this' as our canvas context
// it's not clear to me whether this architecture is right but it's neat ATM.
var renderPath = {
    'MultiPolygon': function(mp) {
        mp.forEach(renderPath.Polygon, this);
    },
    'Polygon': function(p) {
        p.forEach(renderPath.LineString, this);
    },
    'MultiLineString': function(ml) {
        ml.forEach(renderPath.LineString, this);
    },
    'LineString': function(l) {
        this.moveTo(l[0][0], l[0][1]);
        l.slice(1).forEach(function(c){
            this.lineTo(c[0], c[1]);
        }, this);
    },
    'MultiPoint': function(p) {
        console.warn('MultiPoint geometry not implemented in renderPath');
    },
    'Point': function(p) {
        console.warn('Point geometry not implemented in renderPath');
    }
};

function renderData(ctx, zoom, col, row, callback) {
    var sc = Math.pow(2, zoom);
    ctx.scale(sc,sc);
    ctx.translate(-col*256/sc, -row*256/sc);
    // we do a little bit of 
    setTimeout(renderLayers, 5, layers.slice(), ctx, callback, sc);
}

function renderLayers(theLayers, ctx, callback, sc) {
    var layer = theLayers.shift();
    layer.styles.forEach(function(style) {
        ctx.fillStyle = style.fillStyle || '';
        ctx.strokeStyle = style.strokeStyle || '';
        ctx.lineWidth = 'lineWidth' in style ? style.lineWidth / sc : 1.0 / sc;
        layer.features.forEach(function(feature) {
            ctx.beginPath();
            var coordinates = feature.geometry.coordinates;
            renderPath[feature.geometry.type].call(ctx, coordinates);
            if (style.fillStyle) {
                ctx.fill();
            }
            if (style.strokeStyle) {
                ctx.stroke();
            }
        });
    });
    if (theLayers.length == 0) {
        setTimeout(callback, 5);
    }
    else {
        setTimeout(renderLayers, 5, theLayers, ctx, callback, sc);
    }    
}

var server = http.createServer(tile).listen(3000);
/*
var nodes = require("./vendor/multi-node/multi-node").listen({
    port: 3000, 
    nodes: 4
}, server);
*/
console.log('listening on 3000');
