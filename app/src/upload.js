import Vue from 'vue';
import Upload from './Upload.vue';
import store from './Upload/store.js';
import Icon from 'vue-awesome/components/Icon'
import {httpGet} from "./common/util";

Vue.component('icon', Icon);

// wizard: the page carries the translations and the first config answer (upload.pug)
const preload = window.PSITRANSFER_PRELOAD || {};

new Vue({
  el: '#upload',
  data: {
    baseURI: document.head.getElementsByTagName('base')[0].href.replace(/\/$/),
    configFetched: false,
    lang: preload.lang || {},
  },
  store,
  render: h => h(Upload),
  async beforeCreate() {
    // Fetch translations
    try {
      if (!preload.lang) this.lang = await httpGet('lang.json');
      this.$store.commit('LANG', preload.lang || this.lang);
    } catch (e) {
      alert(e);
    }

    // Fetch config
    try {
      await this.$store.dispatch('config/fetch');
    } catch(e) {
      if(e.code !== 'PWDREQ') {
        console.error(e);
      }
    }
    this.configFetched = true;
  }
});

window.PSITRANSFER_VERSION = PSITRANSFER_VERSION;
