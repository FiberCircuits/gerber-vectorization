const ImageTracer = require('imagetracerjs/imagetracer_v1.2.6');

const importButton = document.getElementById('importButton');
const fileInput = document.getElementById('fileInput');
const outputWidthInput = document.getElementById('outputWidth');
const lineWeightInput = document.getElementById('lineWeight');
const rasterDpiInput = document.getElementById('rasterDpi');
const rasterDpiValue = document.getElementById('rasterDpiValue');
const inputPreview = document.getElementById('inputPreview');
const outputPreview = document.getElementById('outputPreview');
const inputHint = document.getElementById('inputHint');
const outputHint = document.getElementById('outputHint');
const traceButton = document.getElementById('traceButton');
const downloadButton = document.getElementById('downloadButton');
const edgeThreshold = 180;
const defaultOutputHint = 'Click on "Trace SVG" once the input image is loaded.';
const traceInProgressHint = 'In progress, it might take a minute...';
let currentOutputSvg = '';
let currentOutputName = 'traced';
let currentOutputPreviewUrl = '';
let currentInputPreviewUrl = '';
let currentRasterUrl = '';
let currentSourceWidth = 0;
let currentSourceHeight = 0;

function convertGerberToSvg(gerber) {
    return new Promise((resolve, reject) => {
        gerberToSvg(gerber, (err, svg) => {
            if (err) {
                reject(err);
            } else {
                resolve(svg);
            }
        });
    });
}

function readPositiveNumber(inputElement) {
    const value = Number.parseFloat(inputElement.value);

    return Number.isFinite(value) && value > 0 ? value : null;
}

function readLineWeight() {
    const value = Number.parseFloat(lineWeightInput.value);

    return Number.isFinite(value) && value > 0 ? value : 1;
}

function getRasterScale() {
    return Number.parseFloat(rasterDpiInput.value) / 96;
}

function getOutputDimensions() {
    if (!currentSourceWidth || !currentSourceHeight) {
        return null;
    }

    const outputWidth = readPositiveNumber(outputWidthInput);

    if (outputWidth) {
        const aspectRatio = currentSourceHeight / currentSourceWidth;

        return { width: outputWidth, height: Math.round(outputWidth * aspectRatio) };
    }

    return { width: currentSourceWidth, height: currentSourceHeight };
}

function syncOutputDimensions() {
    return;
}

function rewriteSvgViewport(svgString, sourceWidth, sourceHeight) {
    const dimensions = getOutputDimensions();

    if (!dimensions) {
        return svgString;
    }

    const parser = new DOMParser();
    const svgDocument = parser.parseFromString(svgString, 'image/svg+xml');
    const svgElement = svgDocument.documentElement;

    svgElement.setAttribute('width', `${dimensions.width}`);
    svgElement.setAttribute('height', `${dimensions.height}`);
    svgElement.setAttribute('viewBox', `0 0 ${sourceWidth} ${sourceHeight}`);

    return new XMLSerializer().serializeToString(svgElement);
}

function traceCurrentRaster() {
    if (!currentInputPreviewUrl || !currentSourceWidth || !currentSourceHeight) {
        return;
    }

    downloadButton.hidden = true;
    outputPreview.hidden = true;
    outputHint.textContent = traceInProgressHint;
    outputHint.hidden = false;

    const image = new Image();

    image.onload = () => {
        const rasterScale = getRasterScale();

        const rasterCanvas = document.createElement('canvas');
        rasterCanvas.width = Math.round(image.naturalWidth * rasterScale);
        rasterCanvas.height = Math.round(image.naturalHeight * rasterScale);
        const rasterContext = rasterCanvas.getContext('2d', { willReadFrequently: true });
        rasterContext.save();
        rasterContext.scale(rasterScale, rasterScale);
        rasterContext.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);
        rasterContext.restore();

        if (currentRasterUrl) {
            URL.revokeObjectURL(currentRasterUrl);
        }

        const bmpBlob = createBmpBlob(rasterCanvas);
        currentRasterUrl = URL.createObjectURL(bmpBlob);

        const edgeMapDataUrl = createEdgeMapDataUrl(rasterCanvas);

        ImageTracer.imageToSVG(
            edgeMapDataUrl,
            (svgString) => {
                const lineOnlySvgString = rewriteSvgViewport(
                    svgString
                        .replace(/fill="[^"]*"/g, 'fill="none"')
                        .replace(/stroke="none"/g, 'stroke="black"')
                        .replace(/stroke="rgb\([^"]*\)"/g, 'stroke="black"')
                        .replace(/stroke-width="[^"]*"/g, 'stroke-width="1"'),
                    rasterCanvas.width,
                    rasterCanvas.height,
                );

                currentOutputSvg = lineOnlySvgString;

                const blob = new Blob([lineOnlySvgString], { type: 'image/svg+xml;charset=utf-8' });
                const downloadUrl = URL.createObjectURL(blob);

                if (currentOutputPreviewUrl) {
                    URL.revokeObjectURL(currentOutputPreviewUrl);
                }

                currentOutputPreviewUrl = downloadUrl;

                outputPreview.src = downloadUrl;
                outputPreview.hidden = false;
                outputHint.hidden = true;
                downloadButton.hidden = false;
                downloadButton.onclick = () => {
                    const downloadBlob = new Blob([currentOutputSvg], {
                        type: 'image/svg+xml;charset=utf-8',
                    });
                    const downloadLink = document.createElement('a');
                    const objectUrl = URL.createObjectURL(downloadBlob);

                    downloadLink.href = objectUrl;
                    downloadLink.download = `${currentOutputName}.svg`;
                    downloadLink.click();

                    setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
                };
            },
            {
                ltres: 0.05,
                qtres: 0.05,
                pathomit: 3,
                strokewidth: readLineWeight(),
                linefilter: true,
                roundcoords: 0.5,
                lcpr: 0,
                qcpr: 0,
                colorsampling: 0,
                numberofcolors: 2,
                scale: 1,
            },
        );
    };

    image.src = currentInputPreviewUrl;
}

function updateTraceButtonState() {
    traceButton.disabled = !currentSourceWidth || !currentSourceHeight;
}

function createBmpBlob(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const width = canvas.width;
    const height = canvas.height;
    const rowStride = Math.floor((24 * width + 31) / 32) * 4;
    const pixelDataSize = rowStride * height;
    const buffer = new ArrayBuffer(14 + 40 + pixelDataSize);
    const view = new DataView(buffer);

    const writeUInt16 = (offset, value) => view.setUint16(offset, value, true);
    const writeUInt32 = (offset, value) => view.setUint32(offset, value, true);

    writeUInt16(0x00, 0x4d42);
    writeUInt32(0x02, buffer.byteLength);
    writeUInt32(0x06, 0);
    writeUInt32(0x0a, 54);
    writeUInt32(0x0e, 40);
    writeUInt32(0x12, width);
    writeUInt32(0x16, height);
    writeUInt16(0x1a, 1);
    writeUInt16(0x1c, 24);
    writeUInt32(0x1e, 0);
    writeUInt32(0x22, pixelDataSize);
    writeUInt32(0x26, 0);
    writeUInt32(0x2a, 0);
    writeUInt32(0x2e, 0);
    writeUInt32(0x32, 0);

    let offset = 54;
    const pixels = imageData.data;
    const rowPadding = rowStride - width * 3;

    for (let y = height - 1; y >= 0; y -= 1) {
        for (let x = 0; x < width; x += 1) {
            const index = (y * width + x) * 4;
            const red = pixels[index];
            const green = pixels[index + 1];
            const blue = pixels[index + 2];

            view.setUint8(offset, blue);
            view.setUint8(offset + 1, green);
            view.setUint8(offset + 2, red);
            offset += 3;
        }

        for (let paddingIndex = 0; paddingIndex < rowPadding; paddingIndex += 1) {
            view.setUint8(offset, 0);
            offset += 1;
        }
    }

    return new Blob([buffer], { type: 'image/bmp' });
}

function createEdgeMapDataUrl(canvas) {
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const sourceData = context.getImageData(0, 0, canvas.width, canvas.height);
    const outputData = context.createImageData(canvas.width, canvas.height);

    for (let index = 0; index < sourceData.data.length; index += 4) {
        const red = sourceData.data[index];
        const green = sourceData.data[index + 1];
        const blue = sourceData.data[index + 2];
        const alpha = sourceData.data[index + 3];
        const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
        const value = luminance < edgeThreshold && alpha > 0 ? 0 : 255;

        outputData.data[index] = value;
        outputData.data[index + 1] = value;
        outputData.data[index + 2] = value;
        outputData.data[index + 3] = 255;
    }

    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = canvas.width;
    outputCanvas.height = canvas.height;
    const outputContext = outputCanvas.getContext('2d', { willReadFrequently: true });
    outputContext.putImageData(outputData, 0, 0);

    return outputCanvas.toDataURL('image/png');
}

importButton.addEventListener('click', () => {
    fileInput.click();
});

outputWidthInput.addEventListener('input', () => {
    syncOutputDimensions();
});

lineWeightInput.addEventListener('input', () => {
    syncOutputDimensions();
});

rasterDpiInput.addEventListener('input', () => {
    rasterDpiValue.textContent = `${rasterDpiInput.value} DPI`;
});

traceButton.addEventListener('click', () => {
    console.log('Tracing...');
    syncOutputDimensions();
    traceCurrentRaster();
});

fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];

    if (!file) {
        return;
    }

    if (currentInputPreviewUrl) {
        URL.revokeObjectURL(currentInputPreviewUrl);
    }

    if (currentRasterUrl) {
        URL.revokeObjectURL(currentRasterUrl);
    }

    let inputUrl = URL.createObjectURL(file);

    if (file.name.endsWith('.gbr')) {
        const data = await file.text();
        const svg = await convertGerberToSvg(data);
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        inputUrl = URL.createObjectURL(blob);
    }

    currentInputPreviewUrl = inputUrl;

    const image = new Image();

    image.onload = () => {
        inputPreview.src = inputUrl;
        inputPreview.hidden = false;
        inputHint.hidden = true;

        currentSourceWidth = image.naturalWidth;
        currentSourceHeight = image.naturalHeight;

        currentOutputName = file.name.replace(/\.[^.]+$/, '');
        downloadButton.hidden = true;
        outputPreview.hidden = true;
        outputHint.textContent = defaultOutputHint;
        outputHint.hidden = false;
        updateTraceButtonState();
    };

    image.src = inputUrl;

    fileInput.value = '';
});
