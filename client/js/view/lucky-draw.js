let Backbone = require("backbone");
let cardData = require("../../../assets/data/cards");
let Util = require("../util");

let LuckyDrawModal = Backbone.View.extend({
  template: require("../../templates/luckyDraw.handlebars"),
  events: {
    "click .luckyDraw": "close",
  },
  initialize: function(options) {
    this.app = options.app;
    // display order: trophy -> card -> coin
    this.trophy = options.gameResult.trophy;
    this.card = options.gameResult.newCard;
    this.coins = options.gameResult.coins;
    this.pages = [];
    if (this.trophy) {
      this.pages.push({trophy: this.trophy});
    }
    if (this.card) {
      this.pages.push({card: this.card});
    }
    if (this.coins) {
      this.pages.push({coins: this.coins});
    }
  },
  close: function() {
    this.pages.shift();
    if (this.pages.length) {
      this.render();
      return;
    }
    this.$el.find(".luckyDraw-background").removeClass("anim-visible");
    this.$el.find(".card-container").removeClass("anim-visible");
    this.$el.find(".dialog").removeClass("anim-visible");
    setTimeout(() => {
      this.remove();
      this.app.reinitialize();
      this.app.goBack();
    }, 1000);
  },
  render() {
    let page = this.pages[0];
    if (page.trophy) {
      return this.renderTrophy();
    } else if (page.coins) {
      return this.renderCoins();
    }
    let cardModel = this.toCardModel(this.card);
    let rarityText = Util.toRarityText(cardModel._data.rarity);
    let factionText = i18n.getText(Util.toFactionText(cardModel._data.faction));
    let text;
    if (cardModel._data.skinOf) {
      text = i18n.getText("lucky_draw_skin_text", [
        factionText, cardModel._data.name, rarityText,
      ]);
    } else if (cardModel._data.type === 3) {
      text = i18n.getText("lucky_draw_leader_text", [
        factionText, cardModel._data.name, rarityText,
      ]);
    } else if (cardModel._data.faction !== "neutral") {
      text = i18n.getText("lucky_draw_text", [
        factionText, cardModel._data.name, rarityText,
      ]);
    } else {
      text = i18n.getText("lucky_draw_text2", [
        cardModel._data.name, rarityText,
      ]);
    }
    this.$el.html(this.template({
      card: cardModel,
      text: text,
    }));
    this.renderAnimation();
    return this;
  },
  renderAnimation: function() {
    setTimeout(() => {
      this.$el.find(".luckyDraw-background").addClass("anim-visible");
      setTimeout(() => {
        this.$el.find(".card-container").addClass("anim-visible");
        this.$el.find(".dialog").addClass("anim-visible");
      }, 1000);
    }, 500);
  },
  renderCoins: function() {
    let text = i18n.getText("lucky_draw_coin_text", [
      this.coins,
    ]);
    this.$el.html(this.template({
      text: text,
    }));
    this.renderAnimation();
    return this;
  },
  renderTrophy: function() {
    let text, card;
    if (Number(this.trophy) === 1) {
      text = i18n.getText("lucky_draw_trophy_gold_text");
      card = "gold_trophy";
    } else {
      text = i18n.getText("lucky_draw_trophy_sliver_text");
      card = "silver_trophy";
    }
    this.$el.html(this.template({
      card: this.toCardModel(card),
      text: text,
    }));
    this.renderAnimation();
    return this;
  },
  toCardModel: function(key, count) {
    if (!key) return null;
    return {
      _key: key,
      _data: cardData[key],
      _count: count || 1,
      _showCount: count ? count > 1 : false,
      large: true,
    };
  },
});

module.exports = LuckyDrawModal;
