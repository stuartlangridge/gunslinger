var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);

app.use(express.static('public'));

http.listen(3000, function(){
    console.log('listening on *:3000');
});

function shuffle(list) {
  var i, j, t;
  for (i = 1; i < list.length; i++) {
    j = Math.floor(Math.random()*(1+i));  // choose j in [0..i]
    if (j != i) {
      t = list[i];                        // swap list[i] and list[j]
      list[i] = list[j];
      list[j] = t;
    }
  }
}
var first = ["Aldo", "Austin", "Abner", "Bill", "Butch", "Chuck", "Colt", "Clint", "Dan", "Dix",
    "Ed", "Frank", "Harry", "Bob", "Larry", "Pete", "Jed", "Joe",
    "Annie", "Alma", "Bessie", "Rose", "Mae", "Jane", "Kate", "Molly", "Nell", "Sam", "Tina"];
var last = ["Afton", "Bronson", "Holliday", "Hickshaw", "McGraw", "Redford", "Sweetwater",
    "Hatfield", "McCormick", "James", "Falcon"];
var moniker = {
    start: ["Buckeye", "Dead-Eye", "Smilin’", "Dutch", "Suspicious", "Nasty", "Sober",
        "Bootless", "Woollen", "Mutton Chops", "Maltese"],
    middle: ["Tenderfoot", "The Lasso", "Killer", "Rattlesnake", "The Cannonball", "Shouter",
        "Backwash", "Dusty"]
};

app.get("/monikers.js", function(req, res) { res.end("var MONIKERS=" + JSON.stringify(moniker) + ";"); });

var LISTCOUNT = 3;

function generateAINames() {
    var names = [];
    var f1 = first.slice(), l1 = last.slice(), ms = moniker.start.slice(), mm = moniker.middle.slice();
    shuffle(f1);
    shuffle(l1);
    shuffle(ms);
    shuffle(mm);
    for (var i=0; i<LISTCOUNT; i++) {
        if (Math.random() < 0.5) {
            names.push([f1[i], "“" + mm[i] + "”", l1[i]].join(" "));
        } else {
            names.push(["“" + ms[i] + "”", f1[i], l1[i]].join(" "));
        }
    }
    var ret = {};
    names.forEach(function(n) { ret[n] = "ai"; })
    return ret;
}

var names = {};
var ai_names = generateAINames();
var battles = {}, battlesById = {};

io.on('connection', function(socket) {
    var myname;
    console.log('a user connected');

    function unregister() { delete names[myname]; myname = null; }

    socket.on('disconnect', function() {
        unregister();
        console.log('user disconnected');
        if (Object.keys(io.sockets.connected).length <= 1) {
            ai_names = generateAINames();
        }
    });
    socket.on('time', function(msg) {
        socket.emit('timereply', {msgid: msg.msgid, time: new Date().getTime()})
        console.log('asked for time by', msg);
    });
    socket.on("start timer", function(msg) {
        var now = new Date().getTime();
        var at = (Math.round(now / 10000) + 1) * 10000;
        socket.emit("fire timer", {at: at});
    });

    socket.on("register", function(msg) {
        var match = names[msg.name];
        if (match) {
            socket.emit("name used", {name: msg.name});
        } else {
            names[msg.name] = socket.id;
            socket.emit("name ok", {name: msg.name});
            myname = msg.name;
        }
    });
    socket.on("getlist", function(msg) {
        var n = [];
        Object.keys(names).forEach(function(nn) {
            if (names[nn] !== socket.id) n.push(nn);
        })
        if (n.length < LISTCOUNT) {
            n = n.concat(Object.keys(ai_names).slice(0, LISTCOUNT - n.length));
        }
        shuffle(n);

        socket.emit("playerlist", {names: n});
    });
    socket.on("challenge", function(msg) {
        var person = names[msg.opponent], ai = ai_names[msg.opponent];
        console.log("challenge", socket.id, "challenges", person, ai);
        if (person) {
            socket.emit("reject", {opponent: msg.opponent});
            console.log("actual pvp not supported yet");
        } else if (ai) {
            socket.emit("accept", {opponent: msg.opponent});
            var players = {"ai": {status: "ready", time: null, name: msg.opponent}};
            players[socket.id] = {status:"not ready", time: null, name: myname};
            var thisbattle = {players: players};
            var thisBattleID = (new Date().getTime()) + "-" + (Math.random());
            battles[thisBattleID] = thisbattle;
            battlesById[socket.id] = thisBattleID;
        } else {
            socket.emit("absent", {opponent: msg.opponent});
        }
    });

    function getMyBattle(sid) {
        // find the battle I'm in
        var battleId = battlesById[sid];
        if (!battleId) { throw new Error("error! not in a battle!", battleId); }
        var battle = battles[battleId];
        if (!battle) { throw new Error("error! no such battle!", battle); }
        var opponent;
        Object.keys(battle.players).forEach(function(k) { if (k !== sid) opponent = k; });

        return {battle:battle, opponent:opponent};
    }

    socket.on("ready", function(msg) {
        var bd = getMyBattle(socket.id);
        console.log("ready", bd);

        // either we're sending ready and they already have, or we're sending ready and they haven't,
        // or we're sending ready and they're an AI
        var firetime = (new Date().getTime()) + 4000 + Math.round(Math.random() * 15000);
        bd.battle.players[socket.id].status == "ready";
        if (bd.battle.players[bd.opponent].status == "ready" && bd.opponent == "ai") {
            // they're an AI. Message us to tell us they're ready, but not them because they're an AI.
            // delay for a second so they look real
            setTimeout(function() { socket.emit("opponent ready", {firetime: firetime}); }, 1000);
        } else if (bd.battle.players[bd.opponent].status == "ready") {
            // they're already ready. Message them and us to say so
            io.emit(bd.opponent, "opponent ready", {firetime: firetime})
            socket.emit("opponent ready", {firetime: firetime});
        } else {
            // we're ready and they aren't. Don't do anything; we'll be triggered by the opponent sending ready
        }

    });

    socket.on("time taken", function(msg) {
        var bd = getMyBattle(socket.id);
        bd.battle.players[socket.id].time = msg.taken;
        if (bd.opponent == "ai") {
            // they're an AI. Randomly decide whether they beat us and by how much, then return it
            var diff = (Math.random() * 200) - 100;
            var aitime = msg.taken == 999999 ? (250 + (Math.random() * 300)) : msg.taken + diff;

            var ret = {
                yourtime: msg.taken,
                theirtime: aitime,
                youwin: msg.taken < aitime,
                opponent: bd.battle.players[bd.opponent].name
            };
            socket.emit("result", ret);
            // delete this battle
            var battleId = battlesById[socket.id];
            delete battlesById[socket.id];
            delete battles[battleId];
        } else if (bd.battle.players[bd.opponent].time !== null) {
            // they have reported their time. Work out who won and tell both
            socket.emit("result", {
                yourtime: msg.taken,
                theirtime: bd.battle.players[bd.opponent].time,
                youwin: msg.taken < bd.battle.players[bd.opponent].time,
                opponent: bd.battle.players[bd.opponent].name
            })
            io.emit(bd.opponent, "result", {
                yourtime: bd.battle.players[bd.opponent].time,
                theirtime: msg.taken,
                youwin: msg.taken > bd.battle.players[bd.opponent].time,
                opponent: myname
            })
            // delete this battle
            delete battlesById[socket.id];
            delete battlesById[bd.opponent];
            delete battles[battleId];
        } else {
            // they haven't reported yet. Wait until they do
        }
    });

});