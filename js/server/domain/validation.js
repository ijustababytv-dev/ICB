'use strict';

const mDomainResources = require('./resources');

/** Accept text only, trim it, and cap its length at the API boundary. */
function cleanString(value, fallback = '') {
  return typeof value === 'string' ? value.trim().slice(0, 500) : fallback;
}

/** Accept only timezone names recognized by the runtime. */
function validTimezone(value) {
  if (typeof value !== 'string' || !value) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch (_error) {
    return false;
  }
}

/** Allow deliberate corrections only for the three defined live resource keys. */
function validResource(resource) {
  return Object.prototype.hasOwnProperty.call(mDomainResources.RESOURCE_META, resource);
}

const DECOR_IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

Object.assign(exports, { cleanString, DECOR_IMAGE_EXT, validTimezone, validResource });
