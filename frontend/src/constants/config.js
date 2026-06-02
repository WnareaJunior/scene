import { Platform } from 'react-native';

export const GOOGLE_MAPS_API_KEY =
  Platform.OS === 'ios'
    ? (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_IOS ?? '')
    : (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY_ANDROID ?? '');
