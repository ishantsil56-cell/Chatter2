// Wire up tweetnacl's random source FIRST — before anything can generate a key.
// React Native has no WebCrypto, so without this every key generation throws
// "no PRNG" and the app dies the moment you sign in. See src/services/crypto/prng.ts.
import './src/services/crypto/prng';

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and ensures the environment is set up correctly for Expo (dev client) and
// for native builds produced by `expo prebuild`.
registerRootComponent(App);
