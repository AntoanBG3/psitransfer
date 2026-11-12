<template lang="pug">
  div(v-if="config && config.retentions")
    .panel.panel-default(:class="{'panel-info': !disabled}")
      .panel-heading
        strong {{ $root.lang.settings }}
      .panel-body
        .form-group
          label(for='retention') {{ $root.lang.retention }}
          |
          select#retention.form-control(:value='effectiveRetention', :disabled='disabled',
          @change="$store.commit('upload/RETENTION', $event.target.value)")
            option(
              v-for='(label, seconds) in config.retentions'
              :value="seconds"
              :selected="seconds === effectiveRetention"
              :disabled="!!linkName && !isLinkNameRetention(seconds)"
            ) {{ $root.lang.retentions[seconds] || label }}
        .form-group(:class="{'has-error': linkNameError}")
          label(for='linkName') {{ $root.lang.linkName }}
          |
          input#linkName.form-control(
            type='text'
            :value='linkName'
            @input='setLinkName($event)'
            :disabled='disabled'
            :placeholder='$root.lang.optional'
            maxlength='40'
            autocapitalize='none'
            autocomplete='off'
            spellcheck='false'
          )
        div
          label(for='password') {{ $root.lang.password }}
          .input-group(:class="{'has-error': passwordRequired && !password}")
            input#password.form-control(
              type='text'
              :value='password'
              @input="$store.commit('upload/PASSWORD', $event.target.value)"
              :disabled='disabled'
              :placeholder="passwordRequired ? $root.lang.required : $root.lang.optional"
              required="config.requireBucketPassword"
            )
            span.input-group-addon(
              style='cursor: pointer'
              :title='$root.lang.generateRandomPassword'
              @click='generatePassword()'
              tabindex="0"
              role="button"
              @keydown.enter.prevent='generatePassword()'
              @keydown.space.prevent='generatePassword()'
            )
              icon(name="key")
        p.link-name-hint(v-if='linkName')
          span.text-danger(v-if='linkNameError') {{ linkNameError }}
          span(v-else) {{ shareUrl }}
          |
          | {{ $root.lang.linkNameHint }}
</template>

<script type="text/babel">
  import { mapState, mapGetters } from 'vuex';
  import 'vue-awesome/icons/key';
  import { isLinkNameRetention } from '../common/linkName';

  const passGen = {
    _pattern: /[A-Z0-9_\-+!]/,
    _getRandomByte: function() {
      const result = new Uint8Array(1);
      let fixedcrypto = window.msCrypto;
      if (!fixedcrypto) {
        fixedcrypto = window.crypto;
      }
      fixedcrypto.getRandomValues(result);
      return result[0];
    },
    generate: function(length) {
      let fixedcrypto2 = window.msCrypto;
      if (!fixedcrypto2) {
        fixedcrypto2 = window.crypto;
      }
      if (!fixedcrypto2 || !fixedcrypto2.getRandomValues) return '';
      return Array.apply(null, { 'length': length }).map(function() {
        let result;
        while (true) {
          result = String.fromCharCode(this._getRandomByte());
          if (this._pattern.test(result)) return result;
        }
      }, this).join('');
    }
  };

  export default {
    name: 'Settings',

    computed: {
      ...mapState({
        config: 'config',
        disabled: 'disabled',
        password: state => state.upload.password,
        linkName: state => state.upload.linkName,
      }),
      ...mapGetters('upload', ['shareUrl', 'passwordRequired', 'linkNameError', 'effectiveRetention']),
    },

    methods: {
      isLinkNameRetention,
      setLinkName(event) {
        this.$store.commit('upload/LINK_NAME', event.target.value);
        // the field shows the name as it is kept: lowercase, hyphens between the words
        const kept = this.$store.state.upload.linkName;
        if (event.target.value !== kept) event.target.value = kept;
      },
      generatePassword() {
        if (this.disabled) return;
        this.$store.commit('upload/PASSWORD', passGen.generate(10));
      }
    }
  };
</script>
