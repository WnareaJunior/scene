// Web stub — expo-file-system's File is native-only, and image uploads
// (avatar, event photos) are out of scope for web v1. Web surfaces that call
// uploadFile are hidden; this throw is the backstop if one slips through.
export function makeUploadPart() {
  throw new Error('Image uploads are not supported on the web yet — use the app.');
}
