// FeedItemHandler.js - Handler for the home feed page

import constants from '../constants.js';
import * as utils from '../utils.js';
import { ItemHandler } from './ItemHandler.js';

const { waitForElement, announceToScreenReader, getAnimationDuration } = utils;

/**
 * Handler for the home feed page with toolbar, filtering, sorting, and search.
 */
export class FeedItemHandler extends ItemHandler {
  INDICATOR_IMAGES = {
    loadTop: ['https://www.svgrepo.com/show/502348/circleupmajor.svg'],
    loadBottom: ['https://www.svgrepo.com/show/502338/circledownmajor.svg'],
    loadTime: ['https://www.svgrepo.com/show/446075/time-history.svg'],
    filter: [
      'https://www.svgrepo.com/show/347140/mail.svg',
      'https://www.svgrepo.com/show/347147/mail-unread.svg',
    ],
    sort: [
      'https://www.svgrepo.com/show/506581/sort-numeric-alt-down.svg',
      'https://www.svgrepo.com/show/506582/sort-numeric-up.svg',
    ],
    preferences: [
      'https://www.svgrepo.com/show/522235/preferences.svg',
      'https://www.svgrepo.com/show/522236/preferences.svg',
    ],
  };

  constructor(name, config, state, api, selector) {
    super(name, config, state, api, selector);
    this.toggleSortOrder = this.toggleSortOrder.bind(this);
    this.onSearchAutocomplete = this.onSearchAutocomplete.bind(this);
    this.onSearchKeydown = this.onSearchKeydown.bind(this);
    this.setFilter = this.setFilter.bind(this);
    this.feedTabObserver = waitForElement(constants.FEED_TAB_SELECTOR, (tab) => {
      utils.observeChanges(
        tab,
        (attributeName, _oldValue, newValue, _target) => {
          if (attributeName == 'class' && newValue.includes('r-13awgt0')) {
            console.log('refresh');
            this.refreshItems();
          }
        },
        false
      );
    });
  }

  applyItemStyle(element, selected) {
    super.applyItemStyle(element, selected);
    const avatarDiv = $(element).find('div[data-testid="userAvatarImage"]');
    if (this.config.get('postActionButtonPosition') == 'Left') {
      const buttonsDiv = $(element)
        .find('button[data-testid="postDropdownBtn"]')
        .parent()
        .parent()
        .parent();

      $(buttonsDiv).parent().css({
        'min-height': '160px',
        'min-width': '80px',
      });
      $(buttonsDiv).parent().children().first().css('flex', '');
      buttonsDiv.css({
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'flex-start',
        position: 'absolute',
        bottom: '0px',
        'z-index': '10',
      });
      $(buttonsDiv).find('> div').css({
        'margin-left': '0px',
        width: '100%',
      });
      $(buttonsDiv).find('> div > div').css({
        width: '100%',
      });
      const buttons = $(buttonsDiv).find('button[data-testid!="postDropdownBtn"]');
      buttons.each((i, button) => {
        $(button).css({
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '12px',
          width: '100%',
          padding: '5px 2px',
        });
        const div = $(button).find('> div').first();
        if (div.length) {
          $(div).css({
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            gap: '12px',
            padding: '0px',
          });
        }
        if ($(button).attr('aria-label').startsWith('Repost')) {
          $(div).css('width', '100%');
        }

        const svg = $(button).find('svg').first();
        $(svg).css({
          'flex-shrink': '0',
          display: 'block',
        });
      });

      avatarDiv.closest('div.r-c97pre').children().eq(0).after(buttonsDiv);
    }
  }

  addToolbar(beforeDiv) {
    this.toolbarDiv = $(`<div id="bsky-navigator-toolbar"/>`);
    $(beforeDiv).before(this.toolbarDiv);

    // Add scroll position indicator at top of toolbar if configured
    const indicatorPosition = this.config.get('scrollIndicatorPosition');
    const indicatorThickness = Math.min(20, Math.max(1, this.config.get('scrollIndicatorThickness') || 6));
    if (indicatorPosition === 'Top toolbar') {
      this.scrollIndicator = $(`<div id="scroll-position-indicator" class="scroll-position-indicator scroll-position-indicator-toolbar" style="height: ${indicatorThickness}px" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="scroll-position-fill"></div></div>`);
      $(this.toolbarDiv).append(this.scrollIndicator);
    }

    // First row: icons
    this.toolbarRow1 = $(`<div class="toolbar-row toolbar-row-1"/>`);
    $(this.toolbarDiv).append(this.toolbarRow1);

    this.topLoadIndicator = $(`
<div id="topLoadIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
</div>`);
    $(this.toolbarRow1).append(this.topLoadIndicator);

    this.sortIndicator = $(
      `<div id="sortIndicator" title="change sort order" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="sortIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.sort[+this.state.feedSortReverse]}"/></div>`
    );
    $(this.toolbarRow1).append(this.sortIndicator);
    $('.indicator-image path').attr('fill', 'currentColor');
    $('#sortIndicator').on('click', (event) => {
      event.preventDefault();
      this.toggleSortOrder();
    });

    this.filterIndicator = $(
      `<div id="filterIndicator" title="show all or unread" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><img id="filterIndicatorImage" class="indicator-image" src="${this.INDICATOR_IMAGES.filter[+this.state.feedHideRead]}"/></div>`
    );
    $(this.toolbarRow1).append(this.filterIndicator);
    $('#filterIndicator').on('click', (event) => {
      event.preventDefault();
      this.toggleHideRead();
    });

    // Second row: search, filter pill, breadcrumbs
    this.toolbarRow2 = $(`<div class="toolbar-row toolbar-row-2"/>`);
    $(this.toolbarDiv).append(this.toolbarRow2);

    // Search wrapper with saved searches
    this.searchWrapper = $(`<div class="search-wrapper"></div>`);
    $(this.toolbarRow2).append(this.searchWrapper);

    // Saved searches dropdown
    this.savedSearchesBtn = $(`
      <button id="saved-searches-btn" class="saved-searches-btn" title="Saved searches" aria-label="Saved searches" aria-haspopup="listbox">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
      </button>
    `);
    $(this.searchWrapper).append(this.savedSearchesBtn);

    this.searchField = $(`<input id="bsky-navigator-search" type="text" placeholder="Filter..."/>`);
    $(this.searchWrapper).append(this.searchField);

    // Save current search button
    this.saveSearchBtn = $(`
      <button id="save-search-btn" class="save-search-btn" title="Save current search" aria-label="Save current search">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </button>
    `);
    $(this.searchWrapper).append(this.saveSearchBtn);

    // Event handlers for saved searches
    this.savedSearchesBtn.on('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleSavedSearchesDropdown();
    });

    this.saveSearchBtn.on('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.saveCurrentSearch();
    });
    $('#bsky-navigator-search').autocomplete({
      minLength: 0,
      appendTo: 'div[data-testid="homeScreenFeedTabs"]',
      source: this.onSearchAutocomplete,
      focus: function (event, _ui) {
        event.preventDefault();
      },
      select: function (event, ui) {
        event.preventDefault();

        const input = this;
        const terms = utils.splitTerms(input.value);
        terms.pop();
        terms.push(ui.item.value);
        input.value = terms.join(' ') + ' ';

        $(this).autocomplete('close');
      },
    });

    $('#bsky-navigator-search').on('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        $(this).autocomplete('close');
        $(this).blur();
      } else if (event.key === 'Tab') {
        const autocompleteMenu = $('.ui-autocomplete:visible');
        const firstItem = autocompleteMenu.children('.ui-menu-item').first();

        if (firstItem.length) {
          const uiItem = firstItem.data('ui-autocomplete-item');
          $(this).autocomplete('close');

          const terms = utils.splitTerms(this.value);
          terms.pop();
          terms.push(uiItem.value);
          this.value = terms.join(' ') + ' ';
          event.preventDefault();
        }
      }
    });

    this.onSearchUpdate = (event) => {
      const val = $(event.target).val();
      console.log(val);

      if (val === '/') {
        $('#bsky-navigator-search').val('');
        $(this.searchField).autocomplete('close');
        $("a[aria-label='Search']")[0].click();
        return;
      }

      this.debouncedSearchUpdate(event);
    };

    this.debouncedSearchUpdate = utils.debounce((event) => {
      const val = $(event.target).val();
      this.setFilter(val.trim());
      this.loadItems();
    }, 300);

    this.onSearchUpdate = this.onSearchUpdate.bind(this);
    $(this.searchField).on('keydown', this.onSearchKeydown);

    $(this.searchField).on('input', this.onSearchUpdate);
    $(this.searchField).on('focus', function () {
      $(this).autocomplete('search', '');
    });
    $(this.searchField).on('autocompletechange autocompleteclose', this.onSearchUpdate);

    $(this.searchField).on('autocompleteselect', this.onSearchUpdate);

    // Width controls (only show when hideRightSidebar is enabled)
    if (this.config.get('hideRightSidebar')) {
      this.widthControls = $(`
        <div id="widthControls" class="width-controls">
          <button id="narrowWidth" title="Narrow content" class="width-btn">−</button>
          <span id="widthDisplay" class="width-display">${this.config.get('postWidthDesktop') || 600}</span>
          <button id="widenWidth" title="Widen content" class="width-btn">+</button>
        </div>
      `);
      $(this.toolbarRow2).append(this.widthControls);

      $('#narrowWidth').on('click', (event) => {
        event.preventDefault();
        this.adjustContentWidth(-50);
      });

      $('#widenWidth').on('click', (event) => {
        event.preventDefault();
        this.adjustContentWidth(50);
      });
    }

    waitForElement('#bsky-navigator-toolbar', null, (_div) => {
      this.addToolbar(beforeDiv);
    });
  }

  onSearchKeydown(event) {
    if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      this.handleInput(event);
    }
  }

  refreshToolbars() {
    waitForElement(constants.TOOLBAR_CONTAINER_SELECTOR, (_indicatorContainer) => {
      waitForElement('div[data-testid="homeScreenFeedTabs"]', (homeScreenFeedTabsDiv) => {
        if (!$('#bsky-navigator-toolbar').length) {
          this.addToolbar(homeScreenFeedTabsDiv);
        }
      });
    });

    waitForElement(constants.STATUS_BAR_CONTAINER_SELECTOR, (statusBarContainer, observer) => {
      if (!$('#statusBar').length) {
        this.addStatusBar($(statusBarContainer).parent().parent().parent().parent().parent());
        observer.disconnect();
      }
    });

    waitForElement('#bsky-navigator-toolbar', (_div) => {
      waitForElement('#statusBar', (_div2) => {
        this.setSortIcons();
      });
    });
  }

  onSearchAutocomplete(request, response) {
    const authors = this.getAuthors().sort((a, b) =>
      a.handle.localeCompare(b.handle, undefined, { sensitivity: 'base' })
    );
    const rules = Object.keys(this.state.rules);

    let term = utils.extractLastTerm(request.term).toLowerCase();
    const isNegation = term.startsWith('!');
    if (isNegation) term = term.substring(1);

    let results = [];

    if (term === '') {
      results = rules.map((r) => ({ label: `$${r}`, value: `$${r}` }));
    } else if (term.startsWith('@') || term.startsWith('$')) {
      const type = term.charAt(0);
      const search = term.substring(1).toLowerCase();

      if (type === '@') {
        results = authors
          .filter(
            (a) =>
              a.handle.toLowerCase().includes(search) ||
              a.displayName.toLowerCase().includes(search)
          )
          .map((a) => ({
            label: `${isNegation ? '!' : ''}@${a.handle} (${a.displayName})`,
            value: `${isNegation ? '!' : ''}@${a.handle}`,
          }));
      } else if (type === '$') {
        results = rules
          .filter((r) => r.toLowerCase().includes(search))
          .map((r) => ({
            label: `${isNegation ? '!' : ''}$${r}`,
          }));
      }
    }
    response(results);
  }

  addStatusBar(statusBarContainer) {
    this.statusBar = $(`<div id="statusBar"></div>`);
    this.statusBarLeft = $(`<div id="statusBarLeft"></div>`);
    this.statusBarCenter = $(`<div id="statusBarCenter"></div>`);
    this.statusBarRight = $(`<div id="statusBarRight"></div>`);

    // Add scroll position indicator inside status bar if configured
    const indicatorPosition = this.config.get('scrollIndicatorPosition');
    const indicatorThickness = Math.min(20, Math.max(1, this.config.get('scrollIndicatorThickness') || 6));
    if (indicatorPosition === 'Bottom status bar') {
      this.scrollIndicator = $(`<div id="scroll-position-indicator" class="scroll-position-indicator" style="height: ${indicatorThickness}px" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="scroll-position-fill"></div></div>`);
      $(this.statusBar).append(this.scrollIndicator);
    }

    $(this.statusBar).append(this.statusBarLeft);
    $(this.statusBar).append(this.statusBarCenter);
    $(this.statusBar).append(this.statusBarRight);
    $(statusBarContainer).append(this.statusBar);

    this.bottomLoadIndicator = $(`
<div id="bottomLoadIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"/>
`);
    $(this.statusBarLeft).append(this.bottomLoadIndicator);

    if (!this.infoIndicator) {
      this.infoIndicator = $(
        `<div id="infoIndicator" class="css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="infoIndicatorText"/></div>`
      );
      $(this.statusBarCenter).append(this.infoIndicator);
    }

    if (!this.preferencesIcon) {
      this.preferencesIcon = $(
        `<div id="preferencesIndicator" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb"><div id="preferencesIcon"><img id="preferencesIconImage" class="indicator-image preferences-icon-overlay" src="${this.INDICATOR_IMAGES.preferences[0]}"/></div></div>`
      );
      $(this.preferencesIcon).on('click', () => {
        $('#preferencesIconImage').attr('src', this.INDICATOR_IMAGES.preferences[1]);
        this.config.open();
      });
      $(this.statusBarRight).append(this.preferencesIcon);
    }
  }

  activate() {
    super.activate();
    this.refreshToolbars();
    waitForElement('#bsky-navigator-search', (el) => {
      $(el).val(this.state.filter);
    });

    // Add scroll listener for viewport indicator updates
    this._scrollHandler = this._throttledScrollUpdate.bind(this);
    window.addEventListener('scroll', this._scrollHandler, { passive: true });
  }

  deactivate() {
    super.deactivate();

    // Remove scroll listener
    if (this._scrollHandler) {
      window.removeEventListener('scroll', this._scrollHandler);
      this._scrollHandler = null;
    }
  }

  _throttledScrollUpdate() {
    if (this._scrollUpdatePending) return;
    this._scrollUpdatePending = true;

    requestAnimationFrame(() => {
      const indicator = $('#scroll-position-indicator');
      if (indicator.length && this.items.length) {
        this.updateViewportIndicator(indicator, this.items.length);
      }
      this._scrollUpdatePending = false;
    });
  }

  isActive() {
    return window.location.pathname == '/';
  }

  toggleSortOrder() {
    this.state.stateManager.updateState({ feedSortReverse: !this.state.feedSortReverse });
    this.setSortIcons();
    $(this.selector).closest('div.thread').removeClass('bsky-navigator-seen');
    this.loadItems();
  }

  setSortIcons() {
    ['top', 'bottom'].forEach((bar) => {
      const which =
        (!this.state.feedSortReverse && bar == 'bottom') ||
        (this.state.feedSortReverse && bar == 'top')
          ? 'Older'
          : 'Newer';
      const img =
        this.INDICATOR_IMAGES[
          `load${bar.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase())}`
        ][0];
      $(`#${bar}LoadIndicator`).empty();
      $(`#${bar}LoadIndicator`).append(`
<div id="load${which}Indicator" title="Load ${which.toLowerCase()} items" class="toolbar-icon css-175oi2r r-1loqt21 r-1otgn73 r-1oszu61 r-16y2uox r-1777fci r-gu64tb">
      <a id="load${which}IndicatorLink">
<img id="load${which}IndicatorImage" class="indicator-image" src="${img}"/>
<img id="loadTime${which}IndicatorImage" class="indicator-image load-time-icon ${which == 'Newer' ? 'image-flip-x' : ''}" src="${this.INDICATOR_IMAGES.loadTime[0]}"/>
</a>
</div>
`);
    });
    $('img#loadOlderIndicatorImage').addClass('image-highlight');
    $('a#loadOlderIndicatorLink').on('click', () => this.loadOlderItems());
  }

  toggleHideRead() {
    this.state.stateManager.updateState({ feedHideRead: !this.state.feedHideRead });
    $(this.selector).closest('div.thread').removeClass('bsky-navigator-seen');
    this.loadItems();
  }

  adjustContentWidth(delta) {
    const currentWidth = this.config.get('postWidthDesktop') || 600;
    const newWidth = Math.max(400, Math.min(1200, currentWidth + delta));

    // Update config
    this.config.set('postWidthDesktop', newWidth);
    this.config.save();

    // Update display
    $('#widthDisplay').text(newWidth);

    // Update CSS
    this.updateContentWidthCSS(newWidth);
  }

  updateContentWidthCSS(contentWidth) {
    const styleId = 'bsky-nav-width-style';
    let styleEl = document.getElementById(styleId);

    if (contentWidth !== 600) {
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      const extraWidth = contentWidth - 600;
      const shiftRight = Math.floor(extraWidth / 2);
      styleEl.textContent = `
        main[role="main"] [style*="max-width: 600px"],
        main[role="main"] [style*="max-width:600px"] {
          max-width: ${contentWidth}px !important;
          transform: translateX(${shiftRight}px) !important;
        }
        #statusBar {
          max-width: ${contentWidth}px !important;
          transform: translateX(${shiftRight}px) !important;
        }
      `;
    } else if (styleEl) {
      styleEl.textContent = '';
    }
  }

  setFilter(text) {
    this.state.stateManager.saveStateImmediately(true, true);
    this.state.filter = text;
    this.updateFilterPill();
  }

  updateFilterPill() {
    const existingPill = $('#bsky-navigator-filter-pill');

    if (!this.state.filter) {
      existingPill.remove();
      return;
    }

    if (!existingPill.length) {
      const pill = $(`
        <div id="bsky-navigator-filter-pill" class="filter-pill" role="status" aria-live="polite">
          <span class="filter-pill-text"></span>
          <button class="filter-pill-clear" aria-label="Clear filter" title="Clear filter">×</button>
        </div>
      `);
      pill.find('.filter-pill-clear').on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.clearFilter();
      });
      $('.toolbar-row-2').append(pill);
    }

    $('#bsky-navigator-filter-pill .filter-pill-text').text(this.state.filter);
    announceToScreenReader(`Filter active: ${this.state.filter}`);
  }

  clearFilter() {
    $('#bsky-navigator-search').val('');
    this.setFilter('');
    this.loadItems();
    announceToScreenReader('Filter cleared');
  }

  getSavedSearches() {
    try {
      const saved = this.config.get('savedSearches') || '[]';
      return JSON.parse(saved);
    } catch (e) {
      return [];
    }
  }

  saveSavedSearches(searches) {
    this.config.set('savedSearches', JSON.stringify(searches));
    this.config.save();
  }

  saveCurrentSearch() {
    const currentSearch = this.state.filter;
    if (!currentSearch || !currentSearch.trim()) {
      announceToScreenReader('No filter to save');
      return;
    }

    const searches = this.getSavedSearches();
    if (searches.includes(currentSearch)) {
      announceToScreenReader('Search already saved');
      return;
    }

    searches.push(currentSearch);
    this.saveSavedSearches(searches);
    announceToScreenReader(`Search "${currentSearch}" saved`);

    // Visual feedback
    this.saveSearchBtn.addClass('save-search-btn-saved');
    setTimeout(() => this.saveSearchBtn.removeClass('save-search-btn-saved'), 300);
  }

  toggleSavedSearchesDropdown() {
    const existing = $('#saved-searches-dropdown');
    if (existing.length) {
      existing.remove();
      return;
    }

    const searches = this.getSavedSearches();
    if (searches.length === 0) {
      announceToScreenReader('No saved searches');
      return;
    }

    const dropdown = $(`
      <div id="saved-searches-dropdown" class="saved-searches-dropdown" role="listbox" aria-label="Saved searches">
        ${searches.map((search, i) => `
          <div class="saved-search-item" role="option" data-search="${this.escapeHtml(search)}">
            <span class="saved-search-text">${this.escapeHtml(search)}</span>
            <button class="saved-search-delete" data-index="${i}" aria-label="Delete saved search" title="Delete">×</button>
          </div>
        `).join('')}
      </div>
    `);

    dropdown.find('.saved-search-item').on('click', (e) => {
      if (!$(e.target).hasClass('saved-search-delete')) {
        const search = $(e.currentTarget).data('search');
        $('#bsky-navigator-search').val(search);
        this.setFilter(search);
        this.loadItems();
        dropdown.remove();
        announceToScreenReader(`Applied saved search: ${search}`);
      }
    });

    dropdown.find('.saved-search-delete').on('click', (e) => {
      e.stopPropagation();
      const index = parseInt($(e.currentTarget).data('index'), 10);
      const searches = this.getSavedSearches();
      const removed = searches.splice(index, 1);
      this.saveSavedSearches(searches);
      $(e.currentTarget).parent().remove();
      announceToScreenReader(`Deleted saved search: ${removed[0]}`);
      if (searches.length === 0) {
        dropdown.remove();
      }
    });

    this.searchWrapper.append(dropdown);

    // Close on click outside
    $(document).one('click', (e) => {
      if (!$(e.target).closest('.search-wrapper').length) {
        dropdown.remove();
      }
    });
  }

  /**
   * Determines if an item should be shown based on read status and filter rules.
   * @param {Element} item - The feed item element
   * @param {Element} _thread - The parent thread element (unused)
   * @returns {boolean} True if item should be shown, false if filtered out
   */
  filterItem(item, _thread) {
    if (this.state.feedHideRead && $(item).hasClass('item-read')) {
      return false;
    }

    if (!this.state.filter || !this.state.rules) {
      return true;
    }

    const activeRules = this.parseFilterRules(this.state.filter);
    return activeRules
      .map((rule) => this.evaluateFilterRule(item, rule))
      .every((result) => result === true);
  }

  /**
   * Parses filter text into structured rule objects.
   * @private
   */
  parseFilterRules(filterText) {
    return filterText.split(/[ ]+/).map((ruleStatement) => {
      const match = ruleStatement.match(/(!)?([$@%])?"?([^"]+)"?/);
      return {
        invert: match[1] === '!',
        matchType: match[2] || null,
        query: match[3],
      };
    });
  }

  /**
   * Evaluates a single filter rule against an item.
   * @private
   */
  evaluateFilterRule(item, rule) {
    let allowed = null;

    switch (rule.matchType) {
      case '$':
        allowed = this.evaluateNamedRule(item, rule.query);
        break;
      case '@':
        allowed = this.filterAuthor(item, rule.query);
        break;
      case '%':
        allowed = this.filterContent(item, rule.query);
        break;
      default:
        allowed = this.filterAuthor(item, rule.query) || this.filterContent(item, rule.query);
    }

    return rule.invert ? !allowed : allowed;
  }

  /**
   * Evaluates a named rule set against an item.
   * @private
   */
  evaluateNamedRule(item, ruleName) {
    const rules = this.state.rules[ruleName];
    if (!rules) {
      console.warn(`Filter rule not found: ${ruleName}`);
      return null;
    }

    let allowed = null;
    for (const rule of rules) {
      if (rule.type === 'all') {
        allowed = rule.action === 'allow';
      } else if (rule.type === 'from' && this.filterAuthor(item, rule.value.substring(1))) {
        allowed = allowed || rule.action === 'allow';
      } else if (rule.type === 'content' && this.filterContent(item, rule.value)) {
        allowed = allowed || rule.action === 'allow';
      }
    }
    return allowed;
  }

  /**
   * Checks if an item's author matches a pattern.
   */
  filterAuthor(item, author) {
    const pattern = new RegExp(author, 'i');
    const handle = this.handleFromItem(item);
    const displayName = this.displayNameFromItem(item);
    return pattern.test(handle) || pattern.test(displayName);
  }

  filterContent(item, query) {
    const pattern = new RegExp(query, 'i');
    const content = $(item).find('div[data-testid="postText"]').text();
    return content.match(pattern);
  }

  highlightFilterMatches(item) {
    // Remove existing highlights
    $(item).find('.filter-highlight').contents().unwrap();

    if (!this.state.filter) return;

    // Parse filter for content terms to highlight
    const terms = this.state.filter.split(/\s+/).filter((term) => {
      // Only highlight content-based searches, not @ or $ prefixed
      return term && !term.startsWith('@') && !term.startsWith('$') && !term.startsWith('!');
    }).map((term) => {
      // Remove % prefix if present
      return term.startsWith('%') ? term.substring(1) : term;
    });

    if (terms.length === 0) return;

    const postText = $(item).find('div[data-testid="postText"]');
    if (!postText.length) return;

    // Create a regex for all terms
    const pattern = new RegExp(`(${terms.map(t => this.escapeRegex(t)).join('|')})`, 'gi');

    postText.contents().each(function () {
      if (this.nodeType === Node.TEXT_NODE) {
        const text = this.textContent;
        if (pattern.test(text)) {
          const highlighted = text.replace(pattern, '<mark class="filter-highlight">$1</mark>');
          $(this).replaceWith(highlighted);
        }
      }
    });
  }

  escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  clearAllHighlights() {
    $('.filter-highlight').contents().unwrap();
  }

  filterThread(thread) {
    // Only consider direct child items, not items nested in embedded posts
    const items = $(thread).find('> div > .item');
    const filteredItems = items.filter('.filtered');
    return items.length !== filteredItems.length;
  }

  filterItems() {
    const hideRead = this.state.feedHideRead;
    $('#filterIndicatorImage').attr('src', this.INDICATOR_IMAGES.filter[+hideRead]);
    $('#filterIndicator').attr(
      'title',
      `show all or unread (currently ${hideRead ? 'unread' : 'all'})`
    );

    // Clear all highlights before re-filtering
    this.clearAllHighlights();

    const parent = $(this.selector).first().closest('.thread').parent();
    const unseenThreads = parent.find('.thread');
    $(unseenThreads).map((i, thread) => {
      $(thread)
        .find('.item')
        .each((i, item) => {
          if (this.filterItem(item, thread)) {
            $(item).removeClass('filtered');
            // Highlight matching text
            this.highlightFilterMatches(item);
          } else {
            $(item).addClass('filtered');
          }
        });

      if (this.filterThread(thread)) {
        $(thread).removeClass('filtered');
      } else {
        $(thread).addClass('filtered');
      }
    });

    $(unseenThreads).map((i, thread) => {
      $(thread)
        .find('.item')
        .each((i, item) => {
          const offset = parseInt($(item).data('bsky-navigator-thread-offset'));
          if (
            offset > 0 &&
            $(item).hasClass('item-unread') &&
            this.config.get('showReplyContext')
          ) {
            const index = parseInt($(thread).data('bsky-navigator-thread-index'));
            const prev = $(
              `div[data-bsky-navigator-thread-index="${index}"] div[data-bsky-navigator-thread-offset="${offset - 1}"]`
            );
            $(prev).removeClass('filtered');
            $(prev).closest('.thread').removeClass('filtered');
          }
        });
    });

    this.refreshItems();
    if (hideRead && $(this.selectedItem).hasClass('item-read')) {
      console.log('jumping');
      this.jumpToNextUnseenItem();
    }
  }

  sortItems() {
    const reversed = this.state.feedSortReverse;
    $('#sortIndicatorImage').attr('src', this.INDICATOR_IMAGES.sort[+reversed]);
    $('#sortIndicator').attr(
      'title',
      `change sort order (currently ${reversed ? 'forward' : 'reverse'} chronological)`
    );

    const parent = $(this.selector).closest('.thread').first().parent();
    const newItems = parent
      .children()
      .filter((i, item) => $(item).hasClass('thread'))
      .get()
      .sort((a, b) => {
        const threadIndexA = parseInt($(a).data('bsky-navigator-thread-index'));
        const threadIndexB = parseInt($(b).data('bsky-navigator-thread-index'));
        const itemIndexA = parseInt($(a).find('.item').data('bsky-navigator-item-index'));
        const itemIndexB = parseInt($(b).find('.item').data('bsky-navigator-item-index'));
        if (threadIndexA !== threadIndexB) {
          return reversed ? threadIndexB - threadIndexA : threadIndexA - threadIndexB;
        }
        return itemIndexA - itemIndexB;
      });
    reversed ^ this.loadingNew
      ? parent.prepend(newItems)
      : parent.children('.thread').last().next().after(newItems);
  }

  updateInfoIndicator() {
    super.updateInfoIndicator();
    this.updateScrollPosition();
    this.updateBreadcrumb();
  }

  updateBreadcrumb() {
    // Create breadcrumb container if it doesn't exist
    let breadcrumb = $('#bsky-navigator-breadcrumb');
    if (!breadcrumb.length) {
      breadcrumb = $(`<nav id="bsky-navigator-breadcrumb" class="breadcrumb" aria-label="Current location"></nav>`);
      $('.toolbar-row-2').append(breadcrumb);
    }

    if (!this.selectedItem || !this.items.length) {
      breadcrumb.empty();
      return;
    }

    const parts = [];

    // Feed name from current tab
    const activeTab = $('div[role="tablist"] [aria-selected="true"]').text().trim();
    if (activeTab) {
      parts.push({ label: activeTab, type: 'feed' });
    } else {
      parts.push({ label: 'Feed', type: 'feed' });
    }

    // Author
    const handle = this.handleFromItem(this.selectedItem);
    const displayName = this.displayNameFromItem(this.selectedItem);
    if (handle) {
      parts.push({ label: displayName || `@${handle}`, type: 'author', handle });
    }

    // Thread/reply position
    if (this.threadIndex != null && this.unrolledReplies.length > 0) {
      parts.push({ label: `Post ${this.threadIndex + 1}/${this.unrolledReplies.length + 1}`, type: 'position' });
    } else if (this.replyIndex != null) {
      const replyCount = $(this.selectedItem).parent().find('.sidecar-post').length;
      parts.push({ label: `Reply ${this.replyIndex + 1}/${replyCount}`, type: 'reply' });
    }

    // Build breadcrumb HTML
    const html = parts.map((part, i) => {
      const isLast = i === parts.length - 1;
      let content = '';

      if (part.type === 'author' && part.handle) {
        content = `<a href="/profile/${part.handle}" class="breadcrumb-link">${this.escapeHtml(part.label)}</a>`;
      } else {
        content = `<span class="breadcrumb-text">${this.escapeHtml(part.label)}</span>`;
      }

      if (!isLast) {
        content += '<span class="breadcrumb-separator" aria-hidden="true">›</span>';
      }

      return `<span class="breadcrumb-item">${content}</span>`;
    }).join('');

    breadcrumb.html(html);
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  updateScrollPosition() {
    const indicator = $('#scroll-position-indicator');
    if (!indicator.length || !this.items.length) return;

    const total = this.items.length;
    const currentIndex = this.index;

    // Create or update segments
    let segments = indicator.find('.scroll-segment');
    if (segments.length !== total) {
      // Rebuild segments
      indicator.find('.scroll-segment').remove();
      indicator.find('.scroll-viewport-indicator').remove();

      for (let i = 0; i < total; i++) {
        const segment = $('<div class="scroll-segment"></div>');
        segment.attr('data-index', i);
        indicator.append(segment);
      }

      // Add viewport indicator
      indicator.append('<div class="scroll-viewport-indicator"></div>');
      segments = indicator.find('.scroll-segment');
    }

    // Update segment states
    segments.each((i, segment) => {
      const $segment = $(segment);
      const item = this.items[i];
      const isRead = item && $(item).hasClass('item-read');
      const isCurrent = i === currentIndex;

      $segment.removeClass('scroll-segment-read scroll-segment-current');
      if (isCurrent) {
        $segment.addClass('scroll-segment-current');
      } else if (isRead) {
        $segment.addClass('scroll-segment-read');
      }
    });

    // Update viewport indicator position
    this.updateViewportIndicator(indicator, total);

    // Update accessibility attributes
    const position = currentIndex + 1;
    const percentage = total > 0 ? Math.round((position / total) * 100) : 0;
    indicator.attr('aria-valuenow', percentage);
    indicator.attr('title', `${position} of ${total} items (${percentage}%)`);
  }

  updateViewportIndicator(indicator, total) {
    const viewportIndicator = indicator.find('.scroll-viewport-indicator');
    if (!viewportIndicator.length || total === 0) return;

    const indicatorWidth = indicator.width();
    const segmentWidth = indicatorWidth / total;

    // Find which items are visible in the viewport
    const viewportTop = window.scrollY;
    const viewportBottom = viewportTop + window.innerHeight;

    let firstVisible = -1;
    let lastVisible = -1;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item) continue;

      const rect = item.getBoundingClientRect();
      const itemTop = rect.top + window.scrollY;
      const itemBottom = itemTop + rect.height;

      // Check if item is at least partially visible
      if (itemBottom > viewportTop && itemTop < viewportBottom) {
        if (firstVisible === -1) firstVisible = i;
        lastVisible = i;
      }
    }

    if (firstVisible === -1) {
      // No items visible, hide viewport indicator
      viewportIndicator.css({ display: 'none' });
      return;
    }

    // Calculate position and width
    const left = firstVisible * segmentWidth;
    const width = (lastVisible - firstVisible + 1) * segmentWidth;

    viewportIndicator.css({
      display: 'block',
      left: `${left}px`,
      width: `${width}px`,
    });
  }

  handleInput(event) {
    const item = this.selectedItem;
    if (event.key == 'a') {
      $(item).find(constants.PROFILE_SELECTOR)[0].click();
    } else if (event.key == 'u') {
      this.loadNewerItems();
    } else if (event.key == ':') {
      this.toggleSortOrder();
    } else if (event.key == '"') {
      this.toggleHideRead();
    } else if (event.key == '/') {
      event.preventDefault();
      $('input#bsky-navigator-search').focus();
    } else if (event.key == ',') {
      this.loadItems();
    } else {
      super.handleInput(event);
    }
  }
}
