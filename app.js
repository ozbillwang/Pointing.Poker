var cluster = require('cluster');

cluster.on('exit', function (worker) {

    // Replace the dead worker
    console.log('Worker %d died : ', worker.id);
    cluster.fork();

});

if (cluster.isMaster) {

  var cpuCount = require('os').cpus().length;
  if(cpuCount > 4){
    cpuCount = 4;
  }

  // Create a worker for each CPU
  for (var i = 0; i < cpuCount; i += 1) {
    cluster.fork();
  }

// Code to run if we're in a worker process
} else {

  // Setup basic express server
  var express = require('express');
  var app = express();
  var server = require('http').createServer(app);
  var io = require('socket.io')(server);
  var redisIO = require('socket.io-redis');
  var redis = require('redis');
  var port = process.env.PORT || 3000;

  var Member = require('./app/models/Member');
  var Room = require('./app/models/Room');

  var redisHost = process.env.REDIS_ADDR || '127.0.0.1';
  var redisPort = process.env.REDIS_PORT || 6379;
  var roomCachePrefix = "ppoker_room_";

  var redisClient = redis.createClient(redisPort, redisHost);

  io.adapter(redisIO({ host: redisHost, port: redisPort }));

  server.listen(port, function () {
    console.log('Server listening at port %d', port);
  });

  app.use(express.static(__dirname + '/public'));

  io.on('connection', function (socket) {

    socket.on('add', function (data) {

      var member = new Member(data);
      var roomKey = member.roomKey.toLowerCase();

      redisClient.get(roomCachePrefix+roomKey, function (err, val) {
          var members = [];

          if(val !== null && typeof(val) === "string" && val !== ""){
            members = JSON.parse(val);
          }
          var memberCount = members.length;
          for(var i=memberCount-1; i >= 0; i--){
            var mbr = members[i];
            if(mbr.name.toLowerCase() !== member.name.toLowerCase()){
              socket.emit('add', mbr);
            } else if(mbr.clientKey !== member.clientKey){
              io.to(roomKey).emit('remove', mbr);
              members.splice(i, i+1);
            }
          }

          members[members.length] = member;

          redisClient.set(roomCachePrefix+roomKey, JSON.stringify(members));

          socket.join(roomKey);

          io.to(roomKey).emit('add', member);

      });

    });

    socket.on('newgame', function (data) {
      var roomKey = data.roomKey.toLowerCase();

      redisClient.get(roomCachePrefix+roomKey, function (err, val) {

          var members = [];

          if(val !== null && typeof(val) === "string" && val !== ""){
            members = JSON.parse(val);
          }

          var memberCount = members.length;
          for(var i=0; i < memberCount; i++){
            members[i].vote = "";
          }

          redisClient.set(roomCachePrefix+roomKey, JSON.stringify(members));

          io.to(roomKey).emit('newgame', {});

      });

    });

    socket.on('vote', function (memberVote) {

      var roomKey = memberVote.roomKey.toLowerCase();

      io.to(roomKey).emit('vote', memberVote);

      redisClient.get(roomCachePrefix+roomKey, function (err, val) {

          var members = [];
          var gameOver = true;

          if(val !== null && typeof(val) === "string" && val !== ""){
            members = JSON.parse(val);
          }

          var memberCount = members.length;
          for(var i=memberCount-1; i >= 0; i--){
            var mbr = members[i];
            if(mbr.clientKey === memberVote.clientKey){
              members[i].vote = memberVote.vote;
            } else if(typeof(mbr.vote) !== "string" || mbr.vote === ""){
              gameOver = false;
            }
          }

          redisClient.set(roomCachePrefix+roomKey, JSON.stringify(members));

          if(gameOver === true){
            io.to(roomKey).emit('showcards', {});
          }

      });

    });

    socket.on('disconnect', function (n1, n2, n3) {
      console.log('disconnect', n1, n2, n3);
    });

  });
}
