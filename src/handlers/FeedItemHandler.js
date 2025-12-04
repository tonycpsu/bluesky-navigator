// FeedItemHandler.js - Handler for the home feed page

import constants from '../constants.js';
import * as utils from '../utils.js';
import { ItemHandler } from './ItemHandler.js';
import { format } from 'date-fns';

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
    // Scroll indicator content type icons
    contentVideo: 'https://www.svgrepo.com/show/333765/camera-movie.svg',
    contentImage: 'https://www.svgrepo.com/show/334014/image-alt.svg',
    contentEmbed: 'https://www.svgrepo.com/show/334050/link-external.svg',
    contentText: 'https://www.svgrepo.com/show/333848/comment.svg',
    contentRepost: 'https://www.svgrepo.com/show/334212/repost.svg',
    contentReply: 'https://www.svgrepo.com/show/334206/reply.svg',
    contentPost: 'https://www.svgrepo.com/show/333882/detail.svg',
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
    const indicatorStyle = this.config.get('scrollIndicatorStyle') || 'Advanced';
    const isAdvancedStyle = indicatorStyle === 'Advanced';
    const zoomWindowSize = isAdvancedStyle ? (parseInt(this.config.get('scrollIndicatorZoom'), 10) || 0) : 0;
    const styleClass = isAdvancedStyle ? 'scroll-indicator-advanced' : 'scroll-indicator-basic';
    // Prepare scroll indicator elements (will be appended after toolbar rows)
    if (indicatorPosition === 'Top toolbar') {
      this.scrollIndicatorContainer = $(`<div class="scroll-indicator-container scroll-indicator-container-toolbar ${styleClass}"></div>`);
      this.scrollIndicatorLabelStart = $(`<span class="scroll-indicator-label scroll-indicator-label-start"></span>`);
      this.scrollIndicatorLabelEnd = $(`<span class="scroll-indicator-label scroll-indicator-label-end"></span>`);
      this.scrollIndicator = $(`<div id="scroll-position-indicator" class="scroll-position-indicator" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="scroll-position-fill"></div><div class="scroll-position-zoom-highlight"></div></div>`);
      this.scrollIndicatorContainer.append(this.scrollIndicatorLabelStart);
      this.scrollIndicatorContainer.append(this.scrollIndicator);
      this.scrollIndicatorContainer.append(this.scrollIndicatorLabelEnd);

      // Add zoom indicator if configured (Advanced mode only)
      if (zoomWindowSize > 0) {
        // Get reference to zoom highlight element
        this.scrollIndicatorZoomHighlight = this.scrollIndicator.find('.scroll-position-zoom-highlight');
        // Create wrapper for both indicators and connector
        this.scrollIndicatorWrapper = $(`<div class="scroll-indicator-wrapper"></div>`);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorContainer);

        // Add connector div between main indicator and zoom with SVG inside
        this.scrollIndicatorConnector = $(`<div class="scroll-indicator-connector">
          <svg class="scroll-indicator-connector-svg" preserveAspectRatio="none">
            <path class="scroll-indicator-connector-path scroll-indicator-connector-left" fill="none"/>
            <path class="scroll-indicator-connector-path scroll-indicator-connector-right" fill="none"/>
          </svg>
        </div>`);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorConnector);

        this.scrollIndicatorZoomContainer = $(`<div class="scroll-indicator-container scroll-indicator-container-toolbar scroll-indicator-zoom-container"></div>`);
        this.scrollIndicatorZoomLabelStart = $(`<span class="scroll-indicator-label scroll-indicator-label-start"></span>`);
        this.scrollIndicatorZoomLabelEnd = $(`<span class="scroll-indicator-label scroll-indicator-label-end"></span>`);
        this.scrollIndicatorZoom = $(`<div id="scroll-position-indicator-zoom" class="scroll-position-indicator scroll-position-indicator-zoom"></div>`);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoomLabelStart);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoom);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoomLabelEnd);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorZoomContainer);
      }
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

    // Append scroll indicators after toolbar rows (so they appear below)
    if (indicatorPosition === 'Top toolbar') {
      if (zoomWindowSize > 0 && this.scrollIndicatorWrapper) {
        $(this.toolbarDiv).append(this.scrollIndicatorWrapper);
        this.setupScrollIndicatorZoomClick();
      } else if (this.scrollIndicatorContainer) {
        $(this.toolbarDiv).append(this.scrollIndicatorContainer);
      }
      this.setupScrollIndicatorClick();
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
    const indicatorStyle = this.config.get('scrollIndicatorStyle') || 'Advanced';
    const isAdvancedStyle = indicatorStyle === 'Advanced';
    const zoomWindowSize = isAdvancedStyle ? (parseInt(this.config.get('scrollIndicatorZoom'), 10) || 0) : 0;
    const styleClass = isAdvancedStyle ? 'scroll-indicator-advanced' : 'scroll-indicator-basic';
    if (indicatorPosition === 'Bottom status bar') {
      this.scrollIndicatorContainer = $(`<div class="scroll-indicator-container ${styleClass}"></div>`);
      this.scrollIndicatorLabelStart = $(`<span class="scroll-indicator-label scroll-indicator-label-start"></span>`);
      this.scrollIndicatorLabelEnd = $(`<span class="scroll-indicator-label scroll-indicator-label-end"></span>`);
      this.scrollIndicator = $(`<div id="scroll-position-indicator" class="scroll-position-indicator" role="progressbar" aria-label="Feed position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="scroll-position-fill"></div><div class="scroll-position-zoom-highlight"></div></div>`);
      this.scrollIndicatorContainer.append(this.scrollIndicatorLabelStart);
      this.scrollIndicatorContainer.append(this.scrollIndicator);
      this.scrollIndicatorContainer.append(this.scrollIndicatorLabelEnd);

      // Add zoom indicator if configured (Advanced mode only)
      if (zoomWindowSize > 0) {
        // Get reference to zoom highlight element
        this.scrollIndicatorZoomHighlight = this.scrollIndicator.find('.scroll-position-zoom-highlight');
        // Create wrapper for both indicators and connector (status bar position)
        this.scrollIndicatorWrapper = $(`<div class="scroll-indicator-wrapper scroll-indicator-wrapper-statusbar"></div>`);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorContainer);

        // Add connector div between main indicator and zoom with SVG inside
        this.scrollIndicatorConnector = $(`<div class="scroll-indicator-connector">
          <svg class="scroll-indicator-connector-svg" preserveAspectRatio="none">
            <path class="scroll-indicator-connector-path scroll-indicator-connector-left" fill="none"/>
            <path class="scroll-indicator-connector-path scroll-indicator-connector-right" fill="none"/>
          </svg>
        </div>`);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorConnector);

        this.scrollIndicatorZoomContainer = $(`<div class="scroll-indicator-container scroll-indicator-zoom-container"></div>`);
        this.scrollIndicatorZoomLabelStart = $(`<span class="scroll-indicator-label scroll-indicator-label-start"></span>`);
        this.scrollIndicatorZoomLabelEnd = $(`<span class="scroll-indicator-label scroll-indicator-label-end"></span>`);
        this.scrollIndicatorZoom = $(`<div id="scroll-position-indicator-zoom" class="scroll-position-indicator scroll-position-indicator-zoom"></div>`);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoomLabelStart);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoom);
        this.scrollIndicatorZoomContainer.append(this.scrollIndicatorZoomLabelEnd);
        this.scrollIndicatorWrapper.append(this.scrollIndicatorZoomContainer);

        $(this.statusBar).append(this.scrollIndicatorWrapper);
        this.setupScrollIndicatorZoomClick();
      } else {
        $(this.statusBar).append(this.scrollIndicatorContainer);
      }
      this.setupScrollIndicatorClick();
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

        // Also update zoom indicator if present (Advanced mode only)
        if (this.scrollIndicatorZoom) {
          const indicatorStyle = this.config.get('scrollIndicatorStyle') || 'Advanced';
          const isAdvancedStyle = indicatorStyle === 'Advanced';
          const heatmapMode = isAdvancedStyle ? (this.config.get('scrollIndicatorHeatmap') || 'None') : 'None';
          const showIcons = isAdvancedStyle ? (this.config.get('scrollIndicatorIcons') !== false) : false;

          // Recalculate engagement data for zoom update
          let engagementData = [];
          let maxScore = 0;
          if (isAdvancedStyle && (heatmapMode !== 'None' || showIcons)) {
            engagementData = this.items.toArray().map((item) => {
              const engagement = this.getPostEngagement(item);
              const score = heatmapMode !== 'None' ? this.calculateEngagementScore(engagement, heatmapMode) : 0;
              if (score > maxScore) maxScore = score;
              return { engagement, score };
            });
          }

          this.updateZoomIndicator(this.index, engagementData, heatmapMode, showIcons, maxScore);
        }
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

    // Get style and heatmap settings
    const indicatorStyle = this.config.get('scrollIndicatorStyle') || 'Advanced';
    const isAdvancedStyle = indicatorStyle === 'Advanced';
    const heatmapMode = isAdvancedStyle ? (this.config.get('scrollIndicatorHeatmap') || 'None') : 'None';
    const showIcons = isAdvancedStyle ? (this.config.get('scrollIndicatorIcons') !== false) : false;

    // Calculate engagement data for heatmap and/or icons (Advanced mode only)
    let engagementData = [];
    let maxScore = 0;

    if (isAdvancedStyle && (heatmapMode !== 'None' || showIcons)) {
      // Note: this.items is a jQuery object, so we need to use .toArray() for proper iteration
      engagementData = this.items.toArray().map((item) => {
        const engagement = this.getPostEngagement(item);
        const score = heatmapMode !== 'None' ? this.calculateEngagementScore(engagement, heatmapMode) : 0;
        if (score > maxScore) maxScore = score;
        return { engagement, score };
      });
    }

    // Update segment states
    segments.each((i, segment) => {
      const $segment = $(segment);
      const item = this.items[i];
      const isRead = item && $(item).hasClass('item-read');
      const isCurrent = i === currentIndex;

      // Remove all state classes
      $segment.removeClass(
        'scroll-segment-read scroll-segment-current ' +
        'scroll-segment-heat-1 scroll-segment-heat-2 scroll-segment-heat-3 scroll-segment-heat-4 ' +
        'scroll-segment-heat-5 scroll-segment-heat-6 scroll-segment-heat-7 scroll-segment-heat-8'
      );

      // Clear existing icon
      $segment.find('.scroll-segment-icon').remove();

      // Apply read state first (can be combined with current)
      if (isRead) {
        $segment.addClass('scroll-segment-read');
      }

      if (isCurrent) {
        $segment.addClass('scroll-segment-current');
      } else if (heatmapMode !== 'None' && engagementData[i]) {
        // Apply heatmap coloring (overrides read state visually)
        const heatLevel = this.getHeatLevel(engagementData[i].score, maxScore);
        if (heatLevel > 0) {
          $segment.addClass(`scroll-segment-heat-${heatLevel}`);
        }
      }

      // Add content icon if enabled
      if (showIcons && engagementData[i]?.engagement) {
        const icon = this.getContentIcon(engagementData[i].engagement);
        if (icon) {
          $segment.append(`<span class="scroll-segment-icon">${icon}</span>`);
        }
      }
    });

    // Hide icons if segments are too narrow
    if (showIcons && total > 0) {
      const indicatorWidth = indicator.width();
      const segmentWidth = indicatorWidth / total;
      // Hide icons if segments are too narrow to display them clearly
      if (segmentWidth < 8) {
        indicator.css('--scroll-icon-display', 'none');
      } else {
        indicator.css('--scroll-icon-display', 'flex');
      }
    }

    // Update viewport indicator position
    this.updateViewportIndicator(indicator, total);

    // Update zoom indicator if present
    if (this.scrollIndicatorZoom) {
      this.updateZoomIndicator(currentIndex, engagementData, heatmapMode, showIcons, maxScore);
    }

    // Update date labels
    this.updateScrollIndicatorLabels();

    // Update accessibility attributes
    const position = currentIndex + 1;
    const percentage = total > 0 ? Math.round((position / total) * 100) : 0;
    indicator.attr('aria-valuenow', percentage);
    indicator.attr('title', `${position} of ${total} items (${percentage}%)`);
  }

  updateScrollIndicatorLabels() {
    if (!this.scrollIndicatorLabelStart || !this.scrollIndicatorLabelEnd) return;
    if (!this.items.length) return;

    // Get timestamps from first and last items
    const firstItem = this.items[0];
    const lastItem = this.items[this.items.length - 1];

    let firstTimestamp = this.getTimestampForItem(firstItem);
    let lastTimestamp = this.getTimestampForItem(lastItem);

    // Swap based on sort order - reverse chronological (default) shows newer first
    const reversed = this.state.feedSortReverse;
    if (firstTimestamp && lastTimestamp) {
      const shouldSwap = reversed
        ? firstTimestamp > lastTimestamp  // Reverse: older should be first (left)
        : firstTimestamp < lastTimestamp; // Forward: newer should be first (left)
      if (shouldSwap) {
        [firstTimestamp, lastTimestamp] = [lastTimestamp, firstTimestamp];
      }
    }

    // Format as compact date/time (e.g., "Dec 4 2:30p" or "11/28 9:15a")
    const formatCompact = (date) => {
      if (!date) return '';
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const isThisYear = date.getFullYear() === now.getFullYear();

      if (isToday) {
        return format(date, 'h:mma').toLowerCase();
      } else if (isThisYear) {
        return format(date, 'M/d h:mma').toLowerCase();
      } else {
        return format(date, 'M/d/yy h:mma').toLowerCase();
      }
    };

    this.scrollIndicatorLabelStart.text(formatCompact(firstTimestamp));
    this.scrollIndicatorLabelEnd.text(formatCompact(lastTimestamp));
  }

  /**
   * Extract engagement metrics from a post element
   */
  getPostEngagement(item) {
    if (!item) return null;

    const $item = $(item);

    // Extract counts from button aria-labels or text content
    const getCount = (selector) => {
      const btn = $item.find(selector);
      if (!btn.length) {
        // Also try looking in parent thread container
        const threadBtn = $item.closest('.thread').find(selector);
        if (threadBtn.length) {
          const label = threadBtn.attr('aria-label') || '';
          const match = label.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/i);
          if (match) return this.parseCount(match[1]);
          return this.parseCount(threadBtn.text().trim()) || 0;
        }
        return 0;
      }
      // Try aria-label first (e.g., "5 likes" or "Like (5 likes)")
      const label = btn.attr('aria-label') || '';
      const match = label.match(/(\d+(?:,\d+)*(?:\.\d+)?[KMB]?)/i);
      if (match) {
        return this.parseCount(match[1]);
      }
      // Try text content
      const text = btn.text().trim();
      return this.parseCount(text) || 0;
    };

    const likes = getCount('button[data-testid="likeBtn"]');
    const reposts = getCount('button[data-testid="repostBtn"]');
    const replies = getCount('button[data-testid="replyBtn"]');

    // Debug: log first item structure
    if (!this._debuggedItem) {
      this._debuggedItem = true;
      console.log('[bsky-navigator] Item structure debug:', {
        itemTag: item.tagName,
        itemClasses: item.className,
        likeBtnFound: $item.find('button[data-testid="likeBtn"]').length,
        likeBtnInThread: $item.closest('.thread').find('button[data-testid="likeBtn"]').length,
        allButtons: $item.find('button').length,
        allButtonsInThread: $item.closest('.thread').find('button').length,
      });
    }

    // Get post timestamp for time-based calculations
    const timestamp = this.getTimestampForItem(item);
    const hoursOld = timestamp ? (Date.now() - timestamp.getTime()) / (1000 * 60 * 60) : 1;

    // Detect content type
    const hasImage = $item.find('img[src*="feed_thumbnail"], img[src*="feed_fullsize"]').length > 0;
    const hasVideo = $item.find('video, div[data-testid*="video"]').length > 0;
    const hasEmbed = $item.find('div[data-testid="contentHider-embed"]').length > 0;

    // Detect post type
    const isRepost = $item.closest('.thread').find('svg[aria-label*="Reposted"]').length > 0 ||
                     $item.closest('.thread').find('div[data-testid*="repost"]').length > 0;
    const isReply = $item.find('div[data-testid*="replyLine"]').length > 0 ||
                    $item.closest('.thread').find('a[href*="/post/"][aria-label*="Reply"]').length > 0;

    return {
      likes,
      reposts,
      replies,
      total: likes + reposts + replies,
      hoursOld: Math.max(0.1, hoursOld), // Minimum 6 minutes to avoid division issues
      hasImage,
      hasVideo,
      hasEmbed,
      hasMedia: hasImage || hasVideo,
      isRepost,
      isReply,
    };
  }

  /**
   * Parse count strings like "1.2K", "5M", etc.
   */
  parseCount(str) {
    if (!str) return 0;
    str = String(str).trim().replace(/,/g, '');
    const match = str.match(/^(\d+(?:\.\d+)?)\s*([KMB])?$/i);
    if (!match) return 0;
    let num = parseFloat(match[1]);
    const suffix = (match[2] || '').toUpperCase();
    if (suffix === 'K') num *= 1000;
    else if (suffix === 'M') num *= 1000000;
    else if (suffix === 'B') num *= 1000000000;
    return Math.round(num);
  }

  /**
   * Calculate engagement score based on heatmap mode
   */
  calculateEngagementScore(engagement, mode) {
    if (!engagement) return 0;

    switch (mode) {
      case 'Engagement Rate':
        // Engagement per hour - normalized for post age
        return engagement.total / engagement.hoursOld;
      case 'Raw Engagement':
        return engagement.total;
      case 'Weighted Engagement':
        // Replies worth more than reposts, reposts worth more than likes
        return (engagement.likes * 1 + engagement.reposts * 2 + engagement.replies * 3) / engagement.hoursOld;
      default:
        return 0;
    }
  }

  /**
   * Get heat level (1-8) for a score relative to all scores
   */
  getHeatLevel(score, maxScore) {
    if (maxScore === 0 || score === 0) return 0;
    const normalized = score / maxScore;
    return Math.min(8, Math.max(1, Math.ceil(normalized * 8)));
  }

  /**
   * Get icon/emoji for post content type
   */
  getContentIcon(engagement) {
    if (!engagement) return '';

    // Top icon: post type (reply, repost, or default post)
    let postTypeIcon;
    if (engagement.isRepost) {
      postTypeIcon = `<img src="${this.INDICATOR_IMAGES.contentRepost}" alt="repost">`;
    } else if (engagement.isReply) {
      postTypeIcon = `<img src="${this.INDICATOR_IMAGES.contentReply}" alt="reply">`;
    } else {
      postTypeIcon = `<img src="${this.INDICATOR_IMAGES.contentPost}" alt="post">`;
    }

    // Bottom icon: media type (video, image, embed, or text-only)
    let mediaIcon;
    if (engagement.hasVideo) {
      mediaIcon = `<img src="${this.INDICATOR_IMAGES.contentVideo}" alt="video">`;
    } else if (engagement.hasImage) {
      mediaIcon = `<img src="${this.INDICATOR_IMAGES.contentImage}" alt="image">`;
    } else if (engagement.hasEmbed) {
      mediaIcon = `<img src="${this.INDICATOR_IMAGES.contentEmbed}" alt="embed">`;
    } else {
      mediaIcon = `<img src="${this.INDICATOR_IMAGES.contentText}" alt="text">`;
    }

    return `<span class="scroll-icon-stack">${postTypeIcon}${mediaIcon}</span>`;
  }

  /**
   * Set up click handler for scroll indicator to jump to posts
   */
  setupScrollIndicatorClick() {
    if (!this.scrollIndicator) return;

    this.scrollIndicator.css('cursor', 'pointer');

    this.scrollIndicator.on('click', (event) => {
      const indicator = $(event.currentTarget);
      const indicatorWidth = indicator.width();
      const clickX = event.pageX - indicator.offset().left;

      // Calculate which segment was clicked based on position
      const total = this.items.length;
      if (total === 0) return;

      const segmentWidth = indicatorWidth / total;
      const clickedIndex = Math.floor(clickX / segmentWidth);

      // Clamp to valid range
      const targetIndex = Math.max(0, Math.min(total - 1, clickedIndex));

      // Jump to the post using setIndex which handles selection and scrolling
      if (targetIndex !== this.index) {
        this.setIndex(targetIndex, false, true);
        this.updateScrollPosition();
        this.updateBreadcrumb();
      }
    });
  }

  /**
   * Set up click handler for zoom indicator to jump to posts
   */
  setupScrollIndicatorZoomClick() {
    if (!this.scrollIndicatorZoom) return;

    this.scrollIndicatorZoom.css('cursor', 'pointer');

    this.scrollIndicatorZoom.on('click', (event) => {
      const zoomIndicator = $(event.currentTarget);
      const indicatorWidth = zoomIndicator.width();
      const clickX = event.pageX - zoomIndicator.offset().left;

      const zoomWindowSize = parseInt(this.config.get('scrollIndicatorZoom'), 10) || 0;
      if (zoomWindowSize === 0) return;

      const total = this.items.length;
      if (total === 0) return;

      // Calculate the window of items being shown
      const halfWindow = Math.floor(zoomWindowSize / 2);
      const windowStart = Math.max(0, this.index - halfWindow);
      const windowEnd = Math.min(total - 1, windowStart + zoomWindowSize - 1);
      const actualWindowSize = windowEnd - windowStart + 1;

      const segmentWidth = indicatorWidth / actualWindowSize;
      const clickedOffset = Math.floor(clickX / segmentWidth);
      const targetIndex = Math.max(0, Math.min(total - 1, windowStart + clickedOffset));

      if (targetIndex !== this.index) {
        this.setIndex(targetIndex, false, true);
        this.updateScrollPosition();
        this.updateBreadcrumb();
      }
    });
  }

  /**
   * Update the zoom indicator showing posts around the current selection
   */
  updateZoomIndicator(currentIndex, engagementData, heatmapMode, showIcons, maxScore) {
    const zoomIndicator = this.scrollIndicatorZoom;
    if (!zoomIndicator) return;

    const zoomWindowSize = parseInt(this.config.get('scrollIndicatorZoom'), 10) || 0;
    if (zoomWindowSize === 0) return;

    const total = this.items.length;
    if (total === 0) return;

    // Calculate the window of items to show
    const halfWindow = Math.floor(zoomWindowSize / 2);
    let windowStart = Math.max(0, currentIndex - halfWindow);

    // Adjust if we would go past the end
    if (windowStart + zoomWindowSize > total) {
      windowStart = Math.max(0, total - zoomWindowSize);
    }

    // Always create exactly zoomWindowSize segments (fixed size)
    let segments = zoomIndicator.find('.scroll-segment');
    if (segments.length !== zoomWindowSize) {
      zoomIndicator.find('.scroll-segment').remove();

      for (let i = 0; i < zoomWindowSize; i++) {
        const segment = $('<div class="scroll-segment scroll-segment-zoom"></div>');
        zoomIndicator.append(segment);
      }
      segments = zoomIndicator.find('.scroll-segment');
    }

    // Update segment states
    const windowEnd = Math.min(total - 1, windowStart + zoomWindowSize - 1);

    segments.each((i, segment) => {
      const $segment = $(segment);
      const itemIndex = windowStart + i;
      const item = this.items[itemIndex];
      const hasItem = itemIndex >= 0 && itemIndex < total;
      const isRead = item && $(item).hasClass('item-read');
      const isCurrent = itemIndex === currentIndex;

      // Update data-index in case window shifted
      $segment.attr('data-index', hasItem ? itemIndex : -1);

      // Remove all state classes
      $segment.removeClass(
        'scroll-segment-read scroll-segment-current scroll-segment-empty ' +
        'scroll-segment-heat-1 scroll-segment-heat-2 scroll-segment-heat-3 scroll-segment-heat-4 ' +
        'scroll-segment-heat-5 scroll-segment-heat-6 scroll-segment-heat-7 scroll-segment-heat-8'
      );

      // Clear existing icon
      $segment.find('.scroll-segment-icon').remove();

      // Mark empty segments (no corresponding item)
      if (!hasItem) {
        $segment.addClass('scroll-segment-empty');
        return;
      }

      if (isCurrent) {
        $segment.addClass('scroll-segment-current');
      } else if (heatmapMode !== 'None' && engagementData[itemIndex]) {
        const heatLevel = this.getHeatLevel(engagementData[itemIndex].score, maxScore);
        if (heatLevel > 0) {
          $segment.addClass(`scroll-segment-heat-${heatLevel}`);
        } else if (isRead) {
          $segment.addClass('scroll-segment-read');
        }
      } else if (isRead) {
        $segment.addClass('scroll-segment-read');
      }

      // Add content icon if enabled
      if (showIcons && engagementData[itemIndex]?.engagement) {
        const icon = this.getContentIcon(engagementData[itemIndex].engagement);
        if (icon) {
          $segment.append(`<span class="scroll-segment-icon">${icon}</span>`);
        }
      }
    });

    // Always show icons in zoom view (segments are larger)
    zoomIndicator.css('--scroll-icon-display', 'flex');

    // Update zoom indicator labels (only for actual items)
    this.updateZoomIndicatorLabels(windowStart, windowEnd);

    // Update connector lines between main indicator and zoom
    this.updateZoomConnector(windowStart, windowEnd, total);
  }

  /**
   * Update the curved connector lines between the main scroll indicator and zoom indicator
   */
  updateZoomConnector(windowStart, windowEnd, total) {
    if (!this.scrollIndicatorConnector || !this.scrollIndicator || !this.scrollIndicatorZoom) {
      return;
    }

    const connectorDiv = this.scrollIndicatorConnector[0];
    if (!connectorDiv) return;

    const svg = connectorDiv.querySelector('.scroll-indicator-connector-svg');
    if (!svg) return;

    // Get the wrapper width for our coordinate system
    const wrapperWidth = this.scrollIndicatorWrapper ? this.scrollIndicatorWrapper.width() : 1000;

    // Get label widths
    const labelWidth = this.scrollIndicatorLabelStart ? this.scrollIndicatorLabelStart.outerWidth() || 0 : 0;
    const zoomLabelWidth = this.scrollIndicatorZoomLabelStart ? this.scrollIndicatorZoomLabelStart.outerWidth() || 0 : 0;

    // Get indicator widths
    const mainWidth = this.scrollIndicator.width() || (wrapperWidth - labelWidth * 2);
    const zoomWidth = this.scrollIndicatorZoom.width() || (wrapperWidth - zoomLabelWidth * 2);

    // Calculate positions as percentages of total items
    const startPercent = windowStart / total;
    const endPercent = (windowEnd + 1) / total;

    // X coordinates on the main indicator
    const mainStartX = labelWidth + (mainWidth * startPercent);
    const mainEndX = labelWidth + (mainWidth * endPercent);

    // X coordinates on the zoom indicator (full width)
    const zoomStartX = zoomLabelWidth;
    const zoomEndX = zoomLabelWidth + zoomWidth;

    // SVG dimensions (must match CSS height)
    const height = 16;
    const svgWidth = wrapperWidth;

    // Set viewBox on the SVG element
    svg.setAttribute('viewBox', `0 0 ${svgWidth} ${height}`);

    const leftPath = svg.querySelector('.scroll-indicator-connector-left');
    const rightPath = svg.querySelector('.scroll-indicator-connector-right');

    // S-curve control points for zoom effect
    // The S-curve goes: start at top, curve down and outward, then curve to meet bottom
    const midY = height / 2;

    if (leftPath) {
      // Left S-curve: starts at mainStartX top, ends at zoomStartX bottom
      // First curve goes down, second curve goes to the left edge
      leftPath.setAttribute('d',
        `M ${mainStartX} 0 ` +
        `C ${mainStartX} ${midY}, ${zoomStartX} ${midY}, ${zoomStartX} ${height}`
      );
    }

    if (rightPath) {
      // Right S-curve: starts at mainEndX top, ends at zoomEndX bottom
      // First curve goes down, second curve goes to the right edge
      rightPath.setAttribute('d',
        `M ${mainEndX} 0 ` +
        `C ${mainEndX} ${midY}, ${zoomEndX} ${midY}, ${zoomEndX} ${height}`
      );
    }

    // Update zoom highlight on main indicator
    if (this.scrollIndicatorZoomHighlight) {
      const highlightLeft = startPercent * 100;
      const highlightWidth = (endPercent - startPercent) * 100;
      this.scrollIndicatorZoomHighlight.css({
        left: `${highlightLeft}%`,
        width: `${highlightWidth}%`
      });
    }
  }

  /**
   * Update the date/time labels for the zoom indicator
   */
  updateZoomIndicatorLabels(windowStart, windowEnd) {
    if (!this.scrollIndicatorZoomLabelStart || !this.scrollIndicatorZoomLabelEnd) return;
    if (!this.items.length) return;

    const firstItem = this.items[windowStart];
    const lastItem = this.items[windowEnd];

    let firstTimestamp = this.getTimestampForItem(firstItem);
    let lastTimestamp = this.getTimestampForItem(lastItem);

    // Swap based on sort order - reverse chronological (default) shows newer first
    const reversed = this.state.feedSortReverse;
    if (firstTimestamp && lastTimestamp) {
      const shouldSwap = reversed
        ? firstTimestamp > lastTimestamp  // Reverse: older should be first (left)
        : firstTimestamp < lastTimestamp; // Forward: newer should be first (left)
      if (shouldSwap) {
        [firstTimestamp, lastTimestamp] = [lastTimestamp, firstTimestamp];
      }
    }

    const formatCompact = (date) => {
      if (!date) return '';
      const now = new Date();
      const isToday = date.toDateString() === now.toDateString();
      const isThisYear = date.getFullYear() === now.getFullYear();

      if (isToday) {
        return format(date, 'h:mma').toLowerCase();
      } else if (isThisYear) {
        return format(date, 'M/d h:mma').toLowerCase();
      } else {
        return format(date, 'M/d/yy h:mma').toLowerCase();
      }
    };

    this.scrollIndicatorZoomLabelStart.text(formatCompact(firstTimestamp));
    this.scrollIndicatorZoomLabelEnd.text(formatCompact(lastTimestamp));
  }

  updateViewportIndicator(indicator, total) {
    const viewportIndicator = indicator.find('.scroll-viewport-indicator');
    if (!viewportIndicator.length || total === 0) return;

    const indicatorWidth = indicator.width();
    const segmentWidth = indicatorWidth / total;

    // Find which items are visible in the viewport, accounting for fixed headers
    // Use the first item's parent container to find where content actually starts
    let topOffset = 0;

    // First, try to get the bottom of our toolbar
    if (this.toolbarDiv) {
      const toolbarRect = this.toolbarDiv[0].getBoundingClientRect();
      topOffset = Math.max(0, toolbarRect.bottom);
    }

    // Also check for Bluesky's sticky tab bar (the "Following", "Discover" tabs)
    const bskyTabBar = document.querySelector('[data-testid="homeScreenFeedTabs"]');
    if (bskyTabBar) {
      const tabBarRect = bskyTabBar.getBoundingClientRect();
      topOffset = Math.max(topOffset, tabBarRect.bottom);
    }

    const viewportTop = topOffset;
    const viewportBottom = window.innerHeight;

    let firstVisible = -1;
    let lastVisible = -1;

    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      if (!item) continue;

      const rect = item.getBoundingClientRect();
      // getBoundingClientRect returns viewport-relative coordinates
      const itemTop = rect.top;
      const itemBottom = rect.bottom;
      const itemHeight = rect.height;

      // Check if item is meaningfully visible (at least 20% or 20px visible, whichever is smaller)
      const minVisible = Math.min(itemHeight * 0.2, 20);
      const visibleTop = Math.max(itemTop, viewportTop);
      const visibleBottom = Math.min(itemBottom, viewportBottom);
      const visibleHeight = visibleBottom - visibleTop;

      if (visibleHeight >= minVisible) {
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
