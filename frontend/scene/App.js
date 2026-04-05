import 'react-native-gesture-handler';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import Scene from './Scene';

export default function App() {
  return (
    <SafeAreaProvider>
      <Scene />
    </SafeAreaProvider>
  );
}