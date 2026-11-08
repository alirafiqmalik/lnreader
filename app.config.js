module.exports = ({ config }) => ({
  ...config,
  name: 'LNReader Personal',
  slug: 'lnreader-personal',
  scheme: ['lnreader-personal', 'lnreader'],
  android: {
    ...config.android,
    package: 'com.alirafiqmalik.lnreader',
  },
  plugins: [...config.plugins, './plugins/withForkBuild'],
});
