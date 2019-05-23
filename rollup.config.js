import { terser } from 'rollup-plugin-terser'
import cleanup from 'rollup-plugin-cleanup'
import json from 'rollup-plugin-json'
//import resolve from 'rollup-plugin-node-resolve'
//import commonjs from 'rollup-plugin-commonjs'

export default {
  input: 'src/index.js',
  external: ['fuse-fs', 'plock', 'timed-trigger', 'emitter', 'filescan', 'sade', 'fs', 'util', 'path', 'os'],
  plugins: [
    json(),
    // resolve(),
    // commonjs(),
    cleanup(),
    process.env.NODE_ENV === 'production' && terser()
  ],
  output: {
    file: 'dist/index.js',
    format: 'cjs',
    sourcemap: false,
  }
}
