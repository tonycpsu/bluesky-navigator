import js from '@eslint/js';

export default [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        navigator: 'readonly',
        history: 'readonly',
        performance: 'readonly',
        requestAnimationFrame: 'readonly',
        TextEncoder: 'readonly',
        ClipboardItem: 'readonly',
        HTMLMediaElement: 'readonly',
        btoa: 'readonly',
        // jQuery
        $: 'readonly',
        jQuery: 'readonly',
        // Handlebars
        Handlebars: 'readonly',
        // Greasemonkey/Tampermonkey globals
        GM_addStyle: 'readonly',
        GM_getValue: 'readonly',
        GM_setValue: 'readonly',
        GM_getResourceText: 'readonly',
        GM_xmlhttpRequest: 'readonly',
        GM_config: 'readonly',
        GM_info: 'readonly',
        unsafeWindow: 'readonly',
        // Timers
        setTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        clearTimeout: 'readonly',
        // Observers
        MutationObserver: 'readonly',
        IntersectionObserver: 'readonly',
        // Other
        URL: 'readonly',
        Intl: 'readonly',
        html2canvas: 'readonly',
        Lock: 'readonly',
      }
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      'no-var': 'warn',
      'no-debugger': 'warn',
    }
  }
];
