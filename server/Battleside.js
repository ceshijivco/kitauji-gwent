var Deck = require("./Deck");
var Hand = require("./Hand");
var Card = require("./Card");
var Field = require("./Field");
var _ = require("underscore");
var Promise = require("jquery-deferred");
const Util = require("./CardUtil");


var Battleside;
Battleside = (function() {
  var Battleside = function(user, n, battle) {
    if(!(this instanceof Battleside)) {
      return (new Battleside(user, n, battle));
    }
    /**
     * constructor here
     */

    var deck = user.getDeck();
    this._isWaiting = true;
    this.socket = user.socket;
    user.setBattleSide(this);

    this.cm = battle.cm;

    this.field = {};
    this.field[Card.TYPE.LEADER] = Field(this);
    this.field[Card.TYPE.CLOSE_COMBAT] = Field(this, true);
    this.field[Card.TYPE.RANGED] = Field(this, true);
    this.field[Card.TYPE.SIEGE] = Field(this, true);

    this.n = n ? "p2" : "p1";
    this._user = user;
    this._name = user.getName();
    this.battle = battle;
    this.hand = Hand();
    this.deck = Deck(deck, this);
    this._discard = [];
    this.isBot = user.isBot();
    this._scores = [];
    this._isWaitForCardAction = false;
    this._isReDrawing = false;
    this._reDrawPromise = null;

    this.runEvent = this.battle.runEvent.bind(this.battle);
    this.on = this.battle.on.bind(this.battle);
    this.off = this.battle.off.bind(this.battle);

    this._events();

    this.on("Turn" + this.getID(), this.onTurnStart, this);
  };
  var r = Battleside.prototype;
  /**
   * methods && properties here
   * r.property = null;
   * r.getProperty = function() {...}
   */
  r._name = null;
  r._discard = null;
  r._scorched = null;
  r._attacked = null;
  r._healed = null;
  r._placedCard = null;
  r._getCard = null;
  r._isNewRound = false;


  r._rubies = 2;
  r._score = 0;
  r._scores = null;
  r._isWaiting = null;
  r._passing = null;

  r.field = null;

  r.socket = null;
  r.n = null;

  r.cm = null;

  r.foe = null;
  r.hand = null;
  r.battle = null;
  r.deck = null;

  r._events = function() {
    var self = this;
    this.receive("activate:leader", function() {
      if(self._isWaiting) return;
      if(self.isPassing()) return;


      var leaderCard = self.getLeader();
      if(leaderCard.isDisabled()) return;

      //console.log("leader activated");

      var ability = leaderCard.getAbility();

      try {
        ability.onActivate.apply(self, [leaderCard]);
      } catch (e) {
        console.warn(e);
        self.update();
        self.turn();
        return;
      }
      leaderCard.setDisabled(true);
      self.battle.sendNotification("msg_leader_activated", [self.getName(), leaderCard.getName()]);
      self.update();
      if(ability.waitResponse) {
        return;
      }
      //self.runEvent("NextTurn", null, [self.foe]);
      self.endTurn();
    })
    this.receive("play:cardFromHand", function(data) {
      if(self._isWaiting) return;
      if(self.isPassing()) return;
      var cardID = data.id;
      var card = self.hand.getCard(cardID);
      if (card === null || card === -1) {
        console.warn("No such card at hand: ", data);
        self.update();
        self.turn();
      }

      try {
        self.playCard(card);
      } catch (e) {
        console.warn(e);
        self.update();
        self.turn();
      }
    })
    this.receive("decoy:replaceWith", function(data) {
      if(self._isWaiting) return;
      var card = self.findCardOnFieldByID(data.cardID);
      /*if(card === -1) throw new Error("decoy:replace | unknown card");*/
      if(card === -1) {
        console.log("decoy:replace | unknown card: ", data);
        self.sendNotificationTo(self, "Possible bug occured: unknown card was chosen by playing decoy ability.");
        //self.endTurn();
        return;
      }
      self.runEvent("Decoy:replaceWith", self, [card]);
    })
    this.receive("cancel:decoy", function() {
      self.off("Decoy:replaceWith");
    })
    this.receive("set:passing", function() {
      self.setPassing(true);
      self._scorched = [];
      self._attacked = [];
      self._healed = [];
      // self.update();

      self.battle.sendNotification("msg_passed", [self.getName()]);
      //self.runEvent("NextTurn", null, [self.foe]);
      self.endTurn();
    })
    this.receive("medic:chooseCardFromDiscard", function(data) {
      if(!data) {
        //self.runEvent("NextTurn", null, [self.foe]);

        self.endTurn();
        return;
      }
      var cardID = data.cardID;
      if (cardID == null) {
        self.endTurn();
        return;
      }
      var card = self.getCardFromDiscard(cardID);
      if(card === -1) {
        console.log("medic:chooseCardFromDiscard | unknown card: ", data);
        self.sendNotificationTo(self, "Possible bug occured: unknown card was chosen by playing medic ability.");
        self.endTurn();
        return;
      }

      self.removeFromDiscard(card);

      self.playCard(card);
    })
    this.receive("emreis_leader4:chooseCardFromDiscard", function(data) {
      if(!data) {
        self.endTurn();
        self.sendNotificationTo(self.foe, "msg_choose_no_card", [self.getName()]);
        //self.runEvent("NextTurn", null, [self.foe]);
        return;
      }
      var cardID = data.cardID;
      var card = self.foe.getCardFromDiscard(cardID);
      if(card === -1) {
        console.log("emreis_leader4:chooseCardFromDiscard | unknown card: ", data);
        self.sendNotificationTo(self, "Possible bug occured: unknown card was chosen by playing nilfgaardian leader ability.");
        self.endTurn();
        return;
      }

      self.foe.removeFromDiscard(card);

      //self.placeCard(card);
      self.sendNotificationTo(self.foe, "msg_choose_discard", [self.getName(), card.getName()]);
      self.hand.add(card);

      self.endTurn();
      // self.runEvent("NextTurn", null, [self.foe]);
    })
    this.receive("agile:field", function(data) {
      var fieldType = data.field;
      if(!(fieldType in [0, 1])) throw new Error("set field agile: false fieldtype " + fieldType);
      self.runEvent("agile:setField", null, [fieldType]);

      self.endTurn();
      //self.runEvent("NextTurn", null, [self.foe]);
    })
    this.receive("cancel:agile", function() {
      self.off("agile:setField");
    })
    this.receive("horn:field", function(data) {
      var fieldType = data.field;
      if(!(fieldType in [0, 1, 2])) throw new Error("set field horn: false fieldtype " + fieldType);
      self.runEvent("horn:setField", null, [fieldType]);

      self.endTurn();
      //self.runEvent("NextTurn", null, [self.foe]);
    })
    this.receive("cancel:horn", function() {
      self.off("horn:setField");
    })
    this.receive("heal:chooseHeal", function(data) {
      if (!self._isWaitForCardAction) return;
      if (data.cardID == null) {
        self.endTurn();
        return;
      }
      var card = self.findCardOnFieldByID(data.cardID);
      if(card === -1) {
        console.log("heal:chooseHeal | unknown card: ", data);
        self.sendNotificationTo(self, "Possible bug occured: unknown card was chosen by playing heal ability.");
        self.endTurn();
        return;
      }
      if (card.hasAbility("hero") || card.hasAbility("decoy")) {
        self.endTurn();
        return;
      }
      self.battle.sendNotification("msg_healed", [self.getName(), card.getName()]);
      card.setBoost("heal", card.getBoostByKey("heal") + Number(data.healPower));
      self._healed.push(card);
      self.update();
      self.endTurn();
    })
    this.receive("attack:chooseAttack", function(data) {
      if (!self._isWaitForCardAction) return;
      if (data.cardID == null) {
        self.endTurn();
        return;
      }
      var card = self.foe.findCardOnFieldByID(data.cardID);
      if(card === -1) {
        console.log("attack:chooseAttack | unknown card: ", data);
        self.sendNotificationTo(self, "Possible bug occured: unknown card was chosen by playing attack ability.");
        self.endTurn();
        return;
      }
      if (card.hasAbility("hero") || card.hasAbility("decoy")) {
        self.endTurn();
        return;
      }
      if (data.grade != null && card.getGrade() !== Number(data.grade)) {
        console.warn("wrong grade");
        self.endTurn();
        return;
      }
      if (data.field != null && card.getType() !== Number(data.field)) {
        console.warn("wrong field");
        self.endTurn();
        return;
      }
      self.battle.sendNotification("msg_attacked", [self.getName(), card.getName()]);
      card.setBoost("attack", card.getBoostByKey("attack") - Number(data.attackPower));
      if (card.getPower(true) <= 0) {
        var removed = self.foe.field[card.getType()].removeCard(card);
        self.foe.addToDiscard(removed, true);
      } else {
        self._attacked.push(card);
        self.update();
      }
      self.endTurn();
    })

  }

  r.rejoin = function(socket) {
    this.socket = socket;
    this._events();
  }

  r.createCard = function(key) {
    return this.cm.create(key, this.n);
  }

  r.isPassing = function() {
    return this._passing;
  }

  r.isWaiting = function() {
    return this._isWaiting;
  }

  r.setUpWeatherFieldWith = function(p2) {
    this.field[Card.TYPE.WEATHER] = p2.field[Card.TYPE.WEATHER] = Field(this);
  }

  r.findCardOnFieldByID = function(id) {
    for(var key in this.field) {
      var field = this.field[key];
      var card = field.getCard(id);
      if(card !== -1) return card;
    }
    /*
        for(var i = 0; i < this._discard.length; i++) {
          var c = this._discard[i];
          if(c.getID() === id) return c;
        }*/
    return -1;
  }

  r.getRandomCardOnField = function() {
    var allCards = this.getFieldCards();
    var rnd = (Math.random() * allCards.length) | 0;


    return allCards[rnd];
  }

  r.getCardFromDiscard = function(id) {
    for(var i = 0; i < this._discard.length; i++) {
      var c = this._discard[i];
      if(c.getID() === id) return c;
    }
    return -1;
  }

  r.getFieldCards = function() {
    var close, range, siege;

    close = this.field[Card.TYPE.CLOSE_COMBAT].get();
    range = this.field[Card.TYPE.RANGED].get();
    siege = this.field[Card.TYPE.SIEGE].get();

    return close.concat(range.concat(siege));
  }

  r.setPassing = function(b) {
    this._passing = b;
    this.send("set:passing", {passing: this._passing}, true);
  }

  r.wait = function() {
    this._isWaiting = true;
    this.send("set:waiting", {waiting: this._isWaiting}, true);
  }

  r.turn = function() {
    this._isWaiting = false;
    this.send("set:waiting", {waiting: this._isWaiting}, true);
  }

  r.setLeadercard = function() {
    var leaderCards = this.deck.find("type", Card.TYPE.LEADER);
    let leaderCard = leaderCards[Math.random() * leaderCards.length | 0];
    for (let card of leaderCards) {
      this.deck.removeFromDeck(card);
    }
    this.field[Card.TYPE.LEADER].add(leaderCard);
  }

  r.getLeader = function() {
    return this.field[Card.TYPE.LEADER].get()[0];
  }

  r.getID = function() {
    return this.n;
  }

  r.draw = function(times, animate) {
    if (times <= 0) return;
    while(times--) {
      var card = this.deck.draw();
      if (!card) return;
      this.hand.add(card);
      if (animate) {
        this._getCard = card;
      }
    }
  }

  r.calcScore = function() {
    var score = 0;
    for(var key in this.field) {
      score += +this.field[key].getScore();
    }
    return this._score = score;
  }

  r.getInfo = function() {
    let isNewRound = this._isNewRound;
    this._isNewRound = false;
    let result = {
      name: this.getName(),
      lives: this._rubies,
      score: this.calcScore(),
      hand: this.hand.length(),
      deck: this.deck.length(),
      faction: this.deck.getFaction(),
      funDeck: this.deck.getFunDeck(),
      discard: this.getDiscard(false).filter(c=>Util.canReplace(c)).map(c=>Util.compress(c)),
      scorched: this.getScorched(false),
      placedCard: this.getPlacedCard(false),
      getCard: this.getGetCard(false),
      healed: this._healed,
      attacked: this._attacked,
      isNewRound: isNewRound,
      passing: this._passing
    }
    this._scorched = [];
    this._healed = [];
    this._attacked = [];
    return result;
  }

  r.getRubies = function() {
    return this._rubies;
  }

  r.getScore = function() {
    return +this.calcScore();
  }

  r.getScores = function() {
    return this._scores;
  }

  r.recordScore = function(score) {
    this._scores.push(score);
  }

  r.removeRuby = function() {
    this._rubies--;
  }

  r.getName = function() {
    return this._name;
  }

  r.getUser = function() {
    return this._user;
  }

  r.send = function(event, msg, isPrivate) {
    msg = msg || {};
    isPrivate = typeof isPrivate === "undefined" ? false : isPrivate;
    msg._roomSide = this.n;

    if(isPrivate) {
      return this.socket.emit(event, msg);
    }
    this.battle.send(event, msg);
  }

  r.receive = function(event, cb) {
    this.socket.on(event, cb);
  }

  r.update = function(self) {
    self = self || false;
    this.runEvent("Update", null, [self]);
  }

  r.onTurnStart = function() {
    this.foe.wait();
    this.turn();

    //wait for cardplay event


  };

  r.playCard = function(card) {
    if(card === null || card === -1) return;
    if(this.isWaiting()) return;
    if(this.isPassing()) return;

    if(!this.placeCard(card)) return;

    this.hand.remove(card);

    // this.update();


    //this.runEvent("NextTurn", null, [this.foe]);
    this.endTurn();
  }

  r.endTurn = function() {
    this.update();
    this._attacked = [];
    this._healed = [];
    this._placedCard = null;
    this._getCard = null;

    this.runEvent("NextTurn", null, [this.foe]);
  }

  r.placeCard = function(card, obj) {
    obj = _.extend({}, obj);

    if(typeof card === "string") {
      //card = Card(card);
      card = this.createCard(card);
    }

    this._scorched = [];
    this._attacked = [];
    this._healed = [];
    this._placedCard = card;
    this.checkAbilities(card, obj);
    if(obj._cancelPlacement && !obj.forceField) {
      return 0;
    }
    if(obj._nextTurn && !obj.forceField) {
      // this.update();
      //this.runEvent("NextTurn", null, [this.foe]);
      this.endTurn();
      return 0;
    }


    var field = obj.forceField || null;
    if(typeof obj.isHorn !== "undefined") {
      if(!field) {
        field = obj.targetSide.field[obj.isHorn];
      }
      field.add(card, true);
    }
    else {
      if(!field) {
        field = obj.targetSide.field[card.getType()];
      }

      field.add(card);
    }


    this.runEvent("EachCardPlace");

    this.checkAbilityOnAfterPlace(card, obj);


    this._isWaitForCardAction = obj._waitResponse;
    if(obj._waitResponse) {
      this.hand.remove(card);
      this.update();
      return 0;
    }

    this.update();

    return 1;
  }

  r.setHorn = function(card, field) {
    var self = this;
    field = typeof field === "undefined" ? null : field;

    if(typeof card === "string") {
      //card = Card(card);
      //card = this.cm.create(card);
      card = this.createCard(card);
    }

    if(typeof field === "number") {
      card.changeType(field);
      this.placeCard(card, {
        isHorn: field,
        forcePlace: true
      });
      self.hand.remove(card);
      return;
    }

    this.send("played:horn", {cardID: card.getID()}, true)
    this.on("horn:setField", function(type) {
      self.off("horn:setField");
      card.changeType(type);
      self.placeCard(card, {
        isHorn: type,
        disabled: true
      });
      self.hand.remove(card);

      self.battle.sendNotification("msg_played", [self.getName(), card.getName()]);
    })
  }

  r.commanderHornAbility = function(card) {
    var field = this.field[card.getType()];
    var id = "commanders_horn";

    if(typeof field === "undefined") {
      //console.log("field unknown | %s", card.getName());
      return;
    }

    if(!field.isOnField(card)) {
      field.get().forEach(function(_card) {
        if(_card.getID() === id) return;
        if(_card.getID() === card.getID()) return;
        if(_card.getType() !== card.getType()) return;
        if(_card.hasAbility("hero")) return;
        _card.setBoost(id, 0);
      })
      this.off("EachCardPlace", card.getUidEvents("EachCardPlace"));
      return;
    }

    field.get().forEach(function(_card) {
      if(_card.getID() === id) return;
      if(_card.getID() === card.getID()) return;
      if(_card.getType() != card.getType()) return;
      if(_card.hasAbility("hero")) return;
      _card.setBoost(id, 0);
      _card.setBoost(id, _card.getPower());
    })
  }

  r.setTightBond = function(card) {
    var field = this.field[card.getType()];
    /*
        var pos = field.getPosition(card);*/
    var cards = field.get();

    card.resetTightBond();

    cards.forEach(function(c) {
      if(c.getID() === card.getID()) return;
      if(c.getBondType() !== card.getBondType()) return;
      card.setBoost(card.getID() + "|tight_bond|" + c.getID(), "tight_bond");
    });

    /*if(pos < 0) return;
    if(pos >= 1 && cards[pos - 1].getName() === cards[pos].getName()){
      cards[pos].setBoost(cards[pos].getID() + "|left", "tight_bond");
    }
    else {
      cards[pos].setBoost(cards[pos].getID() + "|left", 0);
    }

    if(pos < cards.length - 1 && cards[pos + 1].getName() === cards[pos].getName()){
      cards[pos].setBoost(cards[pos].getID() + "|right", "tight_bond");
    }
    else {
      cards[pos].setBoost(cards[pos].getID() + "|right", 0);
    }*/
  }

  r.checkAbilities = function(card, obj, __flag) {
    var self = this;
    obj.targetSide = this;
    if(obj.disabled) return;
    var ability = Array.isArray(__flag) ? __flag : card.getAbility();

    if(Array.isArray(ability) && ability.length) {
      var ret = ability.slice();
      ret.splice(0, 1);
      this.checkAbilities(card, obj, ret);
      ability = ability[0];
    }

    /*if(ability && ability.name === obj.suppress){
      //this.update();
    }*/

    if(ability && !Array.isArray(ability)) {

      if(ability.onBeforePlace) {
        ability.onBeforePlace.apply(this, [card]);
      }
      if(ability.isCommandersHornCard && typeof obj.isHorn === "undefined") {
        this.setHorn(card);
      }
      if(ability.commandersHorn) {
        ability.onEachCardPlace = this.commanderHornAbility;
        ability.onWeatherChange = this.commanderHornAbility;
      }
      if(ability.cancelPlacement && !obj.forcePlace) {
        obj._cancelPlacement = true;
      }
      if(ability.nextTurn) {
        obj._nextTurn = ability.nextTurn;
      }
      if(ability.tightBond) {
        //this.setTightBond(card);
        ability.onAfterPlace = this.setTightBond;
        ability.onEachCardPlace = this.setTightBond;
        //ability.onWeatherChange = this.setTightBond;
      }
      if(ability.scorch) {
        this.scorch(card);
      }
      if(ability.scorchMelee) {
        this.scorchMelee(card);
      }
      if(ability.removeImmediately) {
        this.hand.remove(card);
        this.addToDiscard(card);
      }
      if(ability.waitResponse && !obj.forcePlace) {
        obj._waitResponse = true;
      }
      if (ability.shouldWaitResponse && ability.shouldWaitResponse.call(this)) {
        obj._waitResponse = true;
      }
      if(ability.changeSide) {
        obj.targetSide = this.foe;
      }
      if(typeof ability.weather !== "undefined") {
        ability.onEachTurn = this.setWeather.bind(this, ability.weather);
        ability.onEachCardPlace = this.setWeather.bind(this, ability.weather);
      }
      if(ability.replaceWith && !obj.forcePlace) {
        obj._cancelPlacement = true;
        this.on("Decoy:replaceWith", function(replaceCard) {
          if(replaceCard.getType() == Card.TYPE.LEADER ||
            replaceCard.getType() == Card.TYPE.WEATHER ||
            replaceCard.getType() == Card.TYPE.SPECIAL) {
            return;
          }
          if(replaceCard.getName() === card.getName()) return;
          if(replaceCard.hasAbility("hero")) return;
          self.off("Decoy:replaceWith");
          var field = self.field[replaceCard.getType()];


          field.replaceWith(replaceCard, card);

          self.hand.add(replaceCard);
          self.hand.remove(card);

          self.update();
          //self.runEvent("NextTurn", null, [self.foe]);
          self.endTurn();
          self.battle.sendNotification("msg_played_decoy", [self.getName()]);
        })
      }
      if(ability.onEachTurn) {
        var uid = this.on("EachTurn", ability.onEachTurn, this, [card])
        card._uidEvents["EachTurn"] = uid;
      }
      if(ability.onEachCardPlace) {
        var uid = this.on("EachCardPlace", ability.onEachCardPlace, this, [card]);
        card._uidEvents["EachCardPlace"] = uid;
      }
      if(ability.onWeatherChange) {
        var uid = this.on("WeatherChange", ability.onWeatherChange, this, [card]);
        card._uidEvents["WeatherChange"] = uid;
      }

      //this.update();

    }
  }

  r.checkAbilityOnAfterPlace = function(card, obj, __flag) {
    //var ability = card.getAbility();
    var ability = Array.isArray(__flag) ? __flag : card.getAbility();

    if(Array.isArray(ability) && ability.length) {
      var ret = ability.slice();
      ret.splice(0, 1);
      this.checkAbilityOnAfterPlace(card, obj, ret);
      ability = ability[0];
    }

    if(ability && !Array.isArray(ability)) {
      if(ability.name && ability.name === obj.suppress) {
        //this.update();
        return;
      }
      if(ability.onAfterPlace) {
        ability.onAfterPlace.call(this, card)
      }
    }
  }

  r.setWeather = function(weather, opt) {
    var targetRow = weather;
    var field;
    if(typeof targetRow === "undefined") {
      console.log("setWeather: targetRow undefined", targetRow);
      console.trace(this);
      return;
    }
    opt = opt || {};
    var onRoundEnd = opt.onTurnEnd || false;


    if(targetRow === Card.TYPE.WEATHER) {
      if(!onRoundEnd) {
        this.battle.sendNotification("msg_played_clear_weather", [this.getName()]);
      }
      field = this.field[targetRow];
      field.removeAll();

      for(var i = Card.TYPE.CLOSE_COMBAT; i <= Card.TYPE.SIEGE; i++) {
        var _field1, _field2, _field;
        _field1 = this.field[i].get();
        _field2 = this.foe.field[i].get();
        _field = _field1.concat(_field2);

        _field.forEach(function(_card) {
          if(_card.hasAbility("hero")) return;
          _card.setForcedPower(-1);
        });
      }
      this.runEvent("WeatherChange");
      return;
    }
    var forcedPower = 1;

    if(typeof targetRow === "undefined") {
      console.trace(this);
    }
    var field1 = this.field[targetRow].get();
    var field2 = this.foe.field[targetRow].get();

    field = field1.concat(field2);

    field.forEach(function(_card) {
      if(_card.hasAbility("hero")) return;
      _card.setForcedPower(forcedPower);
    });
    this.runEvent("WeatherChange");
  }

  r.scorchMelee = function(card) {
    var side = this.foe;
    var field = side.field[Card.TYPE.CLOSE_COMBAT];

    this.battle.sendNotification("msg_played", [this.getName(), card.getName()]);

    if(field.getScore() < 10) {
      this.battle.sendNotification("msg_no_scorch");
      return;
    }

    var cards = field.getHighestCards(true);
    var removeCards = field.removeCard(cards);

    side.addToDiscard(removeCards, true);
  }

  r.scorchGraduates = function(card) {
    var cards = this.getFieldCards();
    cards = cards.concat(this.foe.getFieldCards());
    var self = this;

    this.battle.sendNotification("msg_played", [this.getName(), card.getName()]);

    let highest = cards.reduce(function(max, card) {
      if(card.hasAbility("hero") || card.getGrade() !== 3) return max;
      return card.getPower() > max ? card.getPower() : max;
    }, 0);
    let res = cards.filter(function(card) {
      if(card.hasAbility("hero") || card.getGrade() !== 3) return false;
      return card.getPower() === highest;
    });

    res.forEach(function(card) {
      var side = self;
      if(self.foe.field[card.getType()].isOnField(card)) {
        side = self.foe;
      }
      var removed = side.field[card.getType()].removeCard(card);
      side.addToDiscard(removed, true);
    });
  }

  r.scorch = function(card) {/*
    var side = this.foe;
    var field = side.field[Card.TYPE.CLOSE_COMBAT];
    var cards = field.getHighestCards(true);
    var removeCards = field.removeCard(cards);*/
    var cards = this.getFieldCards();
    cards = cards.concat(this.foe.getFieldCards());
    var noHeroes = true;
    var res = [];
    var highest = 0;
    var self = this;

    this.battle.sendNotification("msg_played", [this.getName(), card.getName()]);

    cards.forEach(function(card) {
      if(noHeroes && card.hasAbility("hero") || card.hasAbility("decoy")) return;
      highest = card.getPower() > highest ? card.getPower() : highest;
    })

    cards.forEach(function(card) {
      if(noHeroes && card.hasAbility("hero") || card.hasAbility("decoy")) return;
      if(card.getPower() === highest) res.push(card);
    });

    res.forEach(function(card) {
      var side = self;
      if(self.foe.field[card.getType()].isOnField(card)) {
        side = self.foe;
      }
      var removed = side.field[card.getType()].removeCard(card);
      side.addToDiscard(removed, true);
    })
  }

  r.clearMainFields = function() {
    var rndCard = null;
    if(this.deck.getFaction() === Deck.FACTION.SOUND_EUPHO_S2) {
      rndCard = this.getRandomCardOnField();
      if(rndCard) {
        rndCard.__lock = true;
        this.sendNotification("msg_monsters_triggered", [this.getName(), rndCard.getName()]);
      }
      else {
        this.sendNotification("msg_monsters_not_triggered", [this.getName()]);
      }
    }
    var cards1 = this.field[Card.TYPE.CLOSE_COMBAT].removeAll();
    var cards2 = this.field[Card.TYPE.RANGED].removeAll();
    var cards3 = this.field[Card.TYPE.SIEGE].removeAll();
    var cards4 = this.field[Card.TYPE.WEATHER].removeAll();

    var cards = cards1.concat(cards2.concat(cards3.concat(cards4)));
    this.addToDiscard(cards);
  }

  r.addToDiscard = function(cards, isScorched) {
    var self = this;
    if(!Array.isArray(cards)) {
      cards = [cards];
    }
    cards.forEach(function(_card) {
      if(_card.__lock) {
        delete _card.__lock;
        return;
      }
      self._discard.push(_card);
      if (isScorched) {
        self._scorched.push(_card);
      }
    });
  }

  r.removeFromDiscard = function(card) {
    for(var i = 0; i < this._discard.length; i++) {
      var c = this._discard[i];
      if(c.getID() === card.getID()) {

        this._discard.splice(i, 1);
        return
      }
    }
  }

  r.getDiscard = function(json) {
    if(json) {
      return JSON.stringify(this._discard);
    }
    return this._discard;
  }

  r.getScorched = function(json) {
    if(json) {
      return JSON.stringify(this._scorched);
    }
    return this._scorched;
  }

  r.getPlacedCard = function(json) {
    if(json) {
      return JSON.stringify(this._placedCard);
    }
    return this._placedCard;
  }

  r.getGetCard = function(json) {
    if(json) {
      return JSON.stringify(this._getCard);
    }
    return this._getCard;
  }

  r.resetNewRound = function() {
    this.clearMainFields();
    this.setWeather(5, {
      onTurnEnd: true
    }); //clear weather
    this.setPassing(false);
    this._isNewRound = true;
  }

  r.filter = function(arrCards, opt) {
    var arr = arrCards.slice();

    for(var key in opt) {
      var res = [];
      var prop = key, val = opt[key];


      arrCards.forEach(function(card) {
        var property = card.getProperty(prop);
        if(_.isArray(property)) {
          var _f = false;
          for(var i = 0; i < property.length; i++) {
            if(property[i] === val) {
              _f = true;
              break;
            }
          }
          if(!_f) {
            res.push(card);
          }
        }
        else if(_.isArray(val)) {
          var _f = false;
          for(var i = 0; i < val.length; i++) {
            if(property === val[i]) {
              _f = true;
              break;
            }
          }
          if(!_f) {
            res.push(card);
          }
        }
        else if(card.getProperty(prop) !== val) {
          res.push(card);
        }
      })
      arr = _.intersection(arr, res);
    }

    return arr;
  }

  r.reDraw = function(n) {
    //var hand = this.hand.getCards();
    var self = this;
    var left = n;
    this._reDrawPromise = Promise.Deferred();

    this._isReDrawing = true;
    this.send("redraw:cards", null, true);

    this.receive("redraw:reDrawCard", function(data) {
      var id = data.cardID;
      if(!left) return;
      left--;
      var card = self.hand.remove(id)[0];
      if (!card) {
        console.warn("card undefined in redraw phase: ", data, self.hand.getCards());
        return;
      }

      self.deck.add(card);
      self.deck.shuffle();
      self.draw(1, true);

      if(!left) {
        self.send("redraw:close", null, true);
        self.finishReDraw();
      }

      self.battle.updateSelf(self);
      if (left) {
        self.send("redraw:cards", null, true);
      }
    })

    this.receive("redraw:close_client", function() {
      self.finishReDraw();
    })

    return this._reDrawPromise;

  }

  r.finishReDraw = function() {
    this.wait();
    this._reDrawPromise.resolve("done");
    this.sendNotificationTo(this.foe, "msg_finish_redraw", [this.getName()]);
    this._isReDrawing = false;
  }

  r.isReDrawing = function() {
    return this._isReDrawing;
  }

  r.sendNotificationTo = function(side, msg, values) {
    this.battle.sendNotificationTo(side, msg, values);
  }
  r.sendNotification = function(msg, values) {
    this.battle.sendNotification(msg, values);
  }

  return Battleside;
})();

module.exports = Battleside;