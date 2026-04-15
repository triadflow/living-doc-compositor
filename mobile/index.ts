// Must be first: polyfills crypto.getRandomValues for libsodium.
import 'react-native-get-random-values';
import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

registerRootComponent(App);
