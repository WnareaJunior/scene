// Multipart body part for image uploads — native implementation.
// SDK 54+ global fetch is Expo's WinterCG fetch, which rejects React Native's
// proprietary {uri, name, type} FormData parts; expo-file-system's File
// implements Blob, which it accepts.
import { File } from 'expo-file-system';

export function makeUploadPart(imageUri) {
  return new File(imageUri);
}
