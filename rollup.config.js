import fs from 'fs';
import nodeResolve from "@rollup/plugin-node-resolve";
import typescript from "@rollup/plugin-typescript";
import terser from "@rollup/plugin-terser";
import filesize from "rollup-plugin-filesize";
import dts from 'rollup-plugin-dts';

const meta = JSON.parse(fs.readFileSync('./package.json', { encoding: 'utf-8' }));

const extensions = ['.ts', '.js'];

const commonPlugins = [
    nodeResolve({ extensions }),
];

function createEsConfing({ input, output }) {
    return {
        input,
        output: { file: output, name: "WebSdk", format: "es", },
        plugins: [
            ...commonPlugins,
            filesize({ showBeforeSizes: true, showGzippedSize: true }),
        ],
    };
}

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

const configTsDefs = {
    input: "./src/index.ts",
    output: {
        file: `dist/ts/${meta.name}.js`,
        name: "WebSdk",
        format: "es",
    },
    plugins: [
        ...commonPlugins,
        typescript({
            emitDeclarationOnly: true,
            declaration: true,
        })
    ],
};

function createDtsConfing({ input, output }) {
    return {
        input,
        output: [{ file: output, format: "es" }],
        plugins: [
            dts(),
        ],
    };
}

export default [
    createEsConfing({ input: "./build/index.js", output: `dist/${meta.name}.js` }),
    //configMin,
    //configTsDefs,
    createDtsConfing({ input: "./@types/index.d.ts", output: `dist/${meta.name}.d.ts` }),
];
