const { withEntitlementsPlist, withInfoPlist } = require('expo/config-plugins');

const ENV_FLAG = 'LIVING_DOCS_IOS_PREVIEW_BUILD';

function enabled() {
  return process.env[ENV_FLAG] === '1';
}

module.exports = function withPreviewNotificationsOnly(config) {
  if (!enabled()) return config;

  config = withEntitlementsPlist(config, (cfg) => {
    delete cfg.modResults['aps-environment'];
    return cfg;
  });

  config = withInfoPlist(config, (cfg) => {
    const modes = Array.isArray(cfg.modResults.UIBackgroundModes)
      ? cfg.modResults.UIBackgroundModes.filter((mode) => mode !== 'remote-notification')
      : cfg.modResults.UIBackgroundModes;

    if (Array.isArray(modes) && modes.length === 0) {
      delete cfg.modResults.UIBackgroundModes;
    } else if (modes) {
      cfg.modResults.UIBackgroundModes = modes;
    }

    return cfg;
  });

  return config;
};
