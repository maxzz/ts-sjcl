import fs from 'fs';
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";

const meta = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }));

const extensions = ['.ts', '.js'];

const commonPlugins = [
    nodeResolve({ extensions }),
];

const config = {
    input: "./build/index.js",
    output: {
        file: `dist/${meta.name}.js`,
        name: "WebSdk",
        format: "es",
    },
    plugins: [
        ...commonPlugins,
    ],
};

const configMin = {
    input: "./build/index.js",
    output: {
        file: `dist/${meta.name}.js`,
        name: "WebSdk",
        format: "umd",
        indent: true,
        extend: true,
        banner: `//maxzz ${meta.homepage} v${meta.version}`
    },
    plugins: [
        ...commonPlugins,
        terser(),
    ],
};

export default [
    config,
    //configMin,
];
