/**
 * Autor: Mario Pérez Esteso <mario@geekytheory.com>
 * Web: geekytheory.com
 */

var os = require('os');
var fs = require('fs');
var sys = require('util');
var http = require('http');
var exec = require('child_process').exec;
var async = require('async');
var socket = require('socket.io');

var connectCounter = 0;

var port = process.env.PORT || 8000;

var cmds = {
  cpu: "top -d 0.5 -b -n2 | grep 'Cpu(s)'|tail -n 1 | awk '{print $2 + $4}'",
  top: "top -b -n 1 | head -n 17 | tail -10 | awk '{print $12}'"
};

// http://stackoverflow.com/questions/171251/how-can-i-merge-properties-of-two-javascript-objects-dynamically
function mergeOptions(obj1,obj2){
  var obj3 = {};
  for (var attrname in obj1) {
    obj3[attrname] = obj1[attrname];
  }
  for (var attrname in obj2) {
    obj3[attrname] = obj2[attrname];
  }
  return obj3;
}

//Si todo va bien al abrir el navegador, cargaremos el archivo index.html
function handler(req, res) {
  fs.readFile(__dirname+'/index.html', function(err, data) {
    if (err) {
      //Si hay error, mandaremos un mensaje de error 500
      console.log(err);
      res.writeHead(500);
      return res.end('Error loading index.html');
    }
    res.writeHead(200);
    res.end(data);
  });
}

function checkMem(callback) {
  fs.readFile('/proc/meminfo',function(err,data){
    if(err) {
      callback(err);
    } else {
      var txt = data.toString();
      callback(null,{
        memtotal:   parseInt(txt.match(/MemTotal\:\s+(\d+)\skB/)[1],10),
        memfree:    parseInt(txt.match(/MemFree\:\s+(\d+)\skB/)[1],10),
        membuffers: parseInt(txt.match(/Buffers\:\s+(\d+)\skB/)[1],10),
        memcached:  parseInt(txt.match(/Cached\:\s+(\d+)\skB/)[1],10)
      });
    }
  });
}

function checkCpuUsage(callback) {
  var child = exec(cmds.cpu, function (error, stdout, stderr) {
    if (error) {
      callback(err);
    } else {
      callback(null, { cpuusage: parseFloat(stdout) });
    }
  });
}

function checkTopList(callback) {
  var child = exec(cmds.top, function (error, stdout, stderr) {
    if (error) {
      callback(err);
    } else {
      callback(null, { toplist: stdout });
    }
  });
}

function checkTemp(callback) {
  fs.readFile('/sys/class/thermal/thermal_zone0/temp',function(err,data){
    if(err) {
      callback(err);
    } else {
      var txt = data.toString();
      callback(null,{
        temp:   parseInt(txt,10)/1000
      });
    }
  });
}

function collectInfo(callback) {
  async.reduce([checkTemp,checkMem,checkCpuUsage,checkTopList],{},function(memo,item,next){
    item(function(err,data){
      next(err,mergeOptions(memo,data));
    })
  },function(err,result){
    if(err) {
      callback(err,result);
    } else {
      result.hostname = os.hostname();
      result.uptime = os.uptime();
      result.kernel = os.release();
      result.date = new Date().getTime();
      callback(null,result);
    }
  });
}

var app = http.createServer(handler).listen(port, "0.0.0.0");
var io = socket.listen(app);
//Escuchamos en el puerto $port
app.listen(port);

//Cuando abramos el navegador estableceremos una conexión con socket.io.
//Cada X segundos mandaremos a la gráfica un nuevo valor.
io.sockets.on('connection', function(socket) {
  var address = socket.handshake.address;
  var interval = 5000;
  var closed = false;

  console.log("New connection from " + address.address + ":" + address.port);
  connectCounter++;
  console.log("NUMBER OF CONNECTIONS++: "+connectCounter);
  socket.on('disconnect', function() {
    connectCounter--;
    console.log("NUMBER OF CONNECTIONS--: "+connectCounter);
    closed = true;
  });

  var timer = null;

  var launchCollectInfo = function() {
    timer = null;
    var init = new Date().getTime();
    collectInfo(function(err,data){
      if(err) {
        console.log("error collecting data", data);
      } else {
        if(!closed) {
          var delta = (new Date().getTime())-init;
          // XXX: graph delta time?
          data.process_delta = delta;
          socket.emit("collected",data);
          timer = setTimeout(launchCollectInfo,Math.max(interval-(delta),0));
        }
      }
    });
  };

  socket.on("changeInterval",function(data){
    var new_interval = parseInt(data);
    if(new_interval<1000||new_interval>=60*5*1000) {
      console.log("Invalid new interval:",data);
    } else {
      console.log("change "+address.address + ":" + address.port+" interval to "+new_interval);
      interval = new_interval;
      if(timer!=null) {
        clearTimeout(timer);
        timer = setTimeout(launchCollectInfo,100);
      }
    }
  });

  timer = setTimeout(launchCollectInfo,1000);
});
