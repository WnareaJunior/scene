module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Reanimated 4: the worklets Babel plugin moved to react-native-worklets.
    // Must remain last in the plugins list.
    plugins: ['react-native-worklets/plugin'],
  };
};
