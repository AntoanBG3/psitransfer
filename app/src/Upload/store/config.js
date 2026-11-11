import Vue from 'vue';

export default {
  namespaced: true,

  state: {
    uploadPassRequired: false,
    uploadPass: null,

  },

  mutations: {
    SET(state, val) {
      for (let k in val) {
        Vue.set(state, k, val[k]);
      }
    }
  },

  actions: {
    fetch({commit, state}) {
      // wizard: before a password is entered the answer is already in the page (upload.pug)
      const preload = window.PSITRANSFER_PRELOAD;
      if (preload && !state.uploadPass) {
        if (preload.config) {
          commit('SET', preload.config);
          commit('upload/RETENTION', preload.config.defaultRetention, {root:true});
          return Promise.resolve();
        }
        if (preload.uploadPassRequired) {
          commit('SET', {uploadPassRequired: true, uploadPass: null});
          const e = new Error('Password required');
          e.code = "PWDREQ";
          return Promise.reject(e);
        }
      }
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', 'config.json');
        state.uploadPass && xhr.setRequestHeader('x-passwd', state.uploadPass);
        xhr.onload = () => {
          if(xhr.status === 200) {
            try {
              const conf = JSON.parse(xhr.responseText);
              commit('SET', conf);
              commit('upload/RETENTION', conf.defaultRetention, {root:true});
            }
            catch(e) {
              commit('ERROR', `Config parse Error: ${e.message}`, {root: true});
            }
          }
          else if (xhr.status === 401 || xhr.status === 403) {
            commit('SET', {uploadPassRequired: true, uploadPass: null});
            const e = new Error('Password required');
            e.code = "PWDREQ";
            reject(e);
          }
          else {
            commit('ERROR', `Config load error: ${xhr.status} ${xhr.statusText}`, {root: true});
          }
          resolve();
        };
        xhr.send();
      });
    }
  }
}
