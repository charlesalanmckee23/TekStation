import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.tekstation.app',
  appName: 'TekStation',
  webDir: 'www',
  bundledWebRuntime: false,
  server: {
    cleartext: false,
    androidScheme: 'https'
  },
  ios: {
    contentInset: 'automatic'
  }
};

export default config;
