// Wire up tweetnacl's random source FIRST — before anything can generate a key.
// React Native has no WebCrypto, so without this every key generation throws
// "no PRNG" and the app dies the moment you sign in. See src/services/crypto/prng.ts.
import './src/services/crypto/prng';

import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';
import { setBackgroundMessageHandler } from './src/services/push';

// FCM requires the background handler to be registered at module scope, before
// the React tree mounts. It was previously called from inside a React effect,
// which runs after mount — too late, so a message that arrived while the app was
// backgrounded was never handled. Doing it here is the documented placement.
setBackgroundMessageHandler();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App)
// and ensures the environment is set up correctly for Expo (dev client) and
// for native builds produced by `expo prebuild`.
registerRootComponent(App);
