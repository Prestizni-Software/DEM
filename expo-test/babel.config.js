module.exports = function (api) {
  const platform = api.caller((caller) => caller?.platform);

  api.cache.invalidate(() => platform);

  const plugins = [
    ['@babel/plugin-proposal-decorators', { legacy: true }],
  ];
  if (platform === 'web') {
    plugins.push(['@babel/plugin-proposal-class-properties', { loose: true }]);
  }
  plugins.push('react-native-reanimated/plugin');

  return {
    presets: ['babel-preset-expo'],
    plugins: plugins,
  };
};