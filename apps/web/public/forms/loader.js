/**
 * Centre Amalia CRM — Form Embed Loader v1
 *
 * Usage:
 *   <script src="https://intranet.centroamalia.com/crm/forms/loader.js" data-form-id="FORM_ID"></script>
 *
 * The script:
 *   1. Reads `data-form-id` from its own <script> tag
 *   2. Creates an iframe pointing to /crm/forms/embed/{formId}
 *   3. Forwards UTM and tracking params from the parent page URL
 *   4. Listens for postMessage events to auto-resize the iframe height
 */
(function () {
  'use strict';

  // --- Find our own script tag and read config ---------------------------
  var scripts = document.getElementsByTagName('script');
  var currentScript =
    document.currentScript ||
    (function () {
      // Fallback for older browsers that don't support document.currentScript
      for (var i = scripts.length - 1; i >= 0; i--) {
        if (scripts[i].getAttribute('data-form-id')) return scripts[i];
      }
      return null;
    })();

  if (!currentScript) {
    console.error('[CA Forms] Could not locate loader script tag.');
    return;
  }

  var formId = currentScript.getAttribute('data-form-id');
  if (!formId) {
    console.error('[CA Forms] Missing required data-form-id attribute.');
    return;
  }

  // --- Derive base URL from the script's own src -------------------------
  var scriptSrc = currentScript.getAttribute('src') || '';
  // e.g. "https://intranet.centroamalia.com/crm/forms/loader.js"
  //   → baseUrl = "https://intranet.centroamalia.com/crm"
  var baseUrl = scriptSrc.replace(/\/forms\/loader\.js(\?.*)?$/, '');

  // If src is relative or missing, fall back to current origin
  if (!baseUrl || baseUrl === scriptSrc) {
    baseUrl = window.location.origin;
  }

  // --- Collect tracking params from the parent page ----------------------
  var TRACKING_KEYS = [
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_content',
    'utm_term',
    'fbclid',
    'gclid',
    'msclid',
    'ttclid',
  ];

  var pageParams;
  try {
    pageParams = new URLSearchParams(window.location.search);
  } catch (_) {
    pageParams = null;
  }

  var fwd = [];
  if (pageParams) {
    for (var i = 0; i < TRACKING_KEYS.length; i++) {
      var key = TRACKING_KEYS[i];
      var val = pageParams.get(key);
      if (val) {
        fwd.push(encodeURIComponent(key) + '=' + encodeURIComponent(val));
      }
    }
  }

  var embedPath = '/forms/embed/' + encodeURIComponent(formId);
  var iframeSrc = baseUrl + embedPath + (fwd.length ? '?' + fwd.join('&') : '');

  // --- Create container and iframe ---------------------------------------
  var container = document.createElement('div');
  container.id = 'ca-form-' + formId;
  container.style.width = '100%';
  container.style.overflow = 'hidden';

  var iframe = document.createElement('iframe');
  iframe.src = iframeSrc;
  iframe.width = '100%';
  iframe.height = '600';
  iframe.setAttribute('frameborder', '0');
  iframe.style.border = 'none';
  iframe.style.width = '100%';
  iframe.style.display = 'block';
  iframe.setAttribute('allowtransparency', 'true');
  iframe.setAttribute('title', 'Centre Amalia Form');

  container.appendChild(iframe);

  // Insert right after the script tag
  if (currentScript.parentNode) {
    currentScript.parentNode.insertBefore(container, currentScript.nextSibling);
  } else {
    document.body.appendChild(container);
  }

  // --- Listen for postMessage (height resize + status) -------------------
  window.addEventListener('message', function (e) {
    var data = e.data;
    if (!data) return;

    // Height auto-resize
    if (typeof data.height === 'number') {
      iframe.style.height = data.height + 'px';
    }

    // Scroll-to-top request (e.g. after submission)
    if (data.type === 'form:scrollTop') {
      var rect = iframe.getBoundingClientRect();
      var scrollTop =
        window.pageYOffset || document.documentElement.scrollTop || 0;
      window.scrollTo({ top: rect.top + scrollTop - 20, behavior: 'smooth' });
    }
  });
})();
