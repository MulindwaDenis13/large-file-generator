const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 2000;

const GENERATED_DIR = path.join(__dirname, "generated");

if (!fs.existsSync(GENERATED_DIR)) {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/*
|--------------------------------------------------------------------------
| Get public base URL
|--------------------------------------------------------------------------
|
| LOCAL:
| http://localhost:2000
|
| ONLINE:
| https://walimucoop.com/files
|
*/

function getPublicBaseUrl(req) {
    const host = req.get("host");

    /*
     * If accessed through /files on the production domain,
     * use the /files prefix.
     */
    if (
        host &&
        host.includes("walimucoop.com")
    ) {
        return "https://walimucoop.com/files";
    }

    /*
     * Local development
     */
    return `${req.protocol}://${host}`;
}

/*
|--------------------------------------------------------------------------
| Format bytes
|--------------------------------------------------------------------------
*/

function formatBytes(bytes) {
    if (bytes >= 1_000_000_000) {
        return `${(
            bytes / 1_000_000_000
        ).toFixed(2)} GB`;
    }

    if (bytes >= 1_000_000) {
        return `${(
            bytes / 1_000_000
        ).toFixed(2)} MB`;
    }

    if (bytes >= 1_000) {
        return `${(
            bytes / 1_000
        ).toFixed(2)} KB`;
    }

    return `${bytes} bytes`;
}

/*
|--------------------------------------------------------------------------
| GET GENERATED FILES
|--------------------------------------------------------------------------
*/

app.get("/api/files", (req, res) => {
    try {
        const files = fs
            .readdirSync(GENERATED_DIR)
            .filter(
                filename =>
                    filename.endsWith(".txt")
            )
            .map(filename => {
                const filepath =
                    path.join(
                        GENERATED_DIR,
                        filename
                    );

                const stats =
                    fs.statSync(filepath);

                const baseUrl =
                    getPublicBaseUrl(req);

                return {
                    filename,
                    size: stats.size,
                    sizeFormatted:
                        formatBytes(
                            stats.size
                        ),
                    createdAt:
                        stats.birthtime,
                    url:
                        `${baseUrl}/download/` +
                        encodeURIComponent(
                            filename
                        )
                };
            })
            .sort(
                (a, b) =>
                    new Date(b.createdAt) -
                    new Date(a.createdAt)
            );

        res.json({
            success: true,
            files
        });

    } catch (error) {

        console.error(error);

        res.status(500).json({
            success: false,
            message:
                "Unable to list files"
        });
    }
});

/*
|--------------------------------------------------------------------------
| GENERATE FILE
|--------------------------------------------------------------------------
*/

app.post("/api/generate", async (req, res) => {

    try {

        const size =
            Number(req.body.size);

        if (![1, 2, 3].includes(size)) {

            return res.status(400).json({
                success: false,
                message:
                    "Size must be 1, 2 or 3 GB"
            });
        }

        const targetBytes =
            size * 1_000_000_000;

        const timestamp =
            Date.now();

        const randomId =
            crypto
                .randomBytes(4)
                .toString("hex");

        const filename =
            `test-${size}gb-${timestamp}-${randomId}.txt`;

        const filepath =
            path.join(
                GENERATED_DIR,
                filename
            );

        console.log(
            `Starting ${size} GB generation: ${filename}`
        );

        const stream =
            fs.createWriteStream(
                filepath
            );

        const chunkSize =
            1024 * 1024;

        const chunk =
            Buffer.alloc(
                chunkSize,
                "A"
            );

        let written = 0;

        await new Promise(
            (resolve, reject) => {

                function writeChunk() {

                    while (
                        written <
                        targetBytes
                    ) {

                        const remaining =
                            targetBytes -
                            written;

                        const currentSize =
                            Math.min(
                                chunkSize,
                                remaining
                            );

                        const buffer =
                            currentSize ===
                            chunkSize
                                ? chunk
                                : Buffer.alloc(
                                      currentSize,
                                      "A"
                                  );

                        const canContinue =
                            stream.write(
                                buffer
                            );

                        written +=
                            currentSize;

                        if (!canContinue) {

                            stream.once(
                                "drain",
                                writeChunk
                            );

                            return;
                        }
                    }

                    stream.end();
                }

                stream.on(
                    "finish",
                    resolve
                );

                stream.on(
                    "error",
                    reject
                );

                writeChunk();
            }
        );

        const stats =
            fs.statSync(
                filepath
            );

        const baseUrl =
            getPublicBaseUrl(req);

        const url =
            `${baseUrl}/download/` +
            encodeURIComponent(
                filename
            );

        console.log(
            `Finished: ${filename}`
        );

        res.json({

            success: true,

            message:
                `${size} GB file generated successfully`,

            file: {
                filename,

                size:
                    stats.size,

                sizeFormatted:
                    formatBytes(
                        stats.size
                    ),

                createdAt:
                    stats.birthtime,

                url
            }
        });

    } catch (error) {

        console.error(
            "Generation error:",
            error
        );

        res.status(500).json({

            success: false,

            message:
                "Failed to generate file",

            error:
                error.message
        });
    }
});

/*
|--------------------------------------------------------------------------
| DOWNLOAD FILE
|--------------------------------------------------------------------------
*/

app.get(
    "/download/:filename",
    (req, res) => {

        try {

            const filename =
                path.basename(
                    req.params.filename
                );

            const filepath =
                path.join(
                    GENERATED_DIR,
                    filename
                );

            if (
                !fs.existsSync(
                    filepath
                )
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "File not found"
                });
            }

            const stats =
                fs.statSync(
                    filepath
                );

            res.setHeader(
                "Content-Type",
                "text/plain"
            );

            res.setHeader(
                "Content-Length",
                stats.size
            );

            res.setHeader(
                "Content-Disposition",
                `attachment; filename="${filename}"`
            );

            /*
             * Stream file.
             *
             * The entire 1/2/3 GB file is NOT
             * loaded into RAM.
             */

            const readStream =
                fs.createReadStream(
                    filepath
                );

            readStream.on(
                "error",
                error => {

                    console.error(
                        "Download error:",
                        error
                    );

                    if (
                        !res.headersSent
                    ) {

                        res.status(500)
                            .json({
                                success: false,
                                message:
                                    "Download failed"
                            });

                    } else {

                        res.destroy();
                    }
                }
            );

            readStream.pipe(res);

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Download failed"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| DELETE FILE
|--------------------------------------------------------------------------
*/

app.delete(
    "/api/files/:filename",
    (req, res) => {

        try {

            const filename =
                path.basename(
                    req.params.filename
                );

            const filepath =
                path.join(
                    GENERATED_DIR,
                    filename
                );

            if (
                !fs.existsSync(
                    filepath
                )
            ) {

                return res.status(404).json({

                    success: false,

                    message:
                        "File not found"
                });
            }

            fs.unlinkSync(
                filepath
            );

            res.json({

                success: true,

                message:
                    "File deleted successfully"
            });

        } catch (error) {

            console.error(error);

            res.status(500).json({

                success: false,

                message:
                    "Unable to delete file"
            });
        }
    }
);

/*
|--------------------------------------------------------------------------
| Health
|--------------------------------------------------------------------------
*/

app.get(
    "/health",
    (_req, res) => {

        res.json({
            success: true,
            status: "online"
        });
    }
);

/*
|--------------------------------------------------------------------------
| Start
|--------------------------------------------------------------------------
*/

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `File generator running on port ${PORT}`
        );

        console.log(
            `Local: http://localhost:${PORT}`
        );

    }
);