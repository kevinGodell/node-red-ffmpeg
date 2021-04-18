'use strict';

const jsonParse = str => {
  try {
    return JSON.parse(str);
  } catch (e) {
    return undefined;
  }
};

module.exports = jsonParse;
