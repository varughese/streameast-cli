const { exec } = require("child_process");
const { chromium } = require("playwright");
const fs = require("fs");
const axios = require("axios");
const cheerio = require("cheerio");

async function fetchStreamEastLinks() {
    try {
        // Fetch the webpage
        const response = await axios.get("https://the.streameast.app/v76");

        // Load HTML content into Cheerio
        const $ = cheerio.load(response.data);

        // Array to store links containing 'nba'
        const nbaLinks: Array<{ link: string; text: string }> = [];

        // Find all links and iterate through them
        $("a").each((index, element) => {
            const link = $(element).attr("href"); // Extract link
            const text = $(element).text().trim().replace(/\n+/g, " ").replace(/\s+/g, " ").trim(); // Extract text inside the link

            // Check if the text contains 'nba'
            if (text.toLowerCase().includes("nba") && text.includes("vs")) {
                nbaLinks.push({ link, text }); // Add to the array
            }
        });

        return nbaLinks;
    } catch (error) {
        console.error("Error fetching data:", error);
    }
}

async function main({ filter }: { filter: string }) {
    const nbaLinks = (await fetchStreamEastLinks()) || [];
    console.log("Found:");
    nbaLinks?.forEach((l) => console.log("\t >" + l.text));

    // Convert wildcard pattern to regex
    const regexPattern = filter.replace(/\*/g, '.*');
    const regex = new RegExp(regexPattern, 'i');

    // Filter links based on the pattern
    const filteredLinks = nbaLinks.filter(link => regex.test(link.text));

    if (filteredLinks.length === 0) {
        console.error("No matches found for filter:", filter);
        process.exit(1);
    }

    console.log("\nPicking " + filteredLinks[0].text + "\n" + filteredLinks[0].link);
    const nbaLink = filteredLinks[0].link;

    const browser = await chromium.launch({
        headless: true,
        executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the website
    await page.goto(nbaLink);

    // Optional: Handle popups or advertisements
    // This is a simple example; you might need more complex handling depending on the popups
    page.on("popup", async (popup: any) => {
        await popup.close();
    });

    // Wait for at least one iframe to appear
    await page.waitForSelector('iframe');

    // Get all frames (including main frame and all iframes)
    const allFrames = page.frames();

    // Find the iframe that contains a video element
    const videoFrame = await (async () => {
        for (const frame of allFrames) {
            try {
                const hasVideo = await frame.$$eval('video', (elements: Element[]) => elements.length > 0);
                if (hasVideo) {
                    return frame;
                }
            } catch (e) {
                // Skip frames that we can't access
                continue;
            }
        }
        return null;
    })();

    if (!videoFrame) {
        console.error("Could not find frame with video element");
        process.exit(1);
    }

    console.log("Selected frame URL:", videoFrame.url());

    // Get all scripts in the selected frame
    const scripts = await videoFrame.$$eval('script', (elements: Element[]) => {
        return elements.map((script) => {
            const scriptElement = script as HTMLScriptElement;
            return {
                src: scriptElement.src || 'inline script',
                contentLength: scriptElement.textContent?.length || 0,
                type: scriptElement.type || 'text/javascript',
                textContent: scriptElement.textContent || ''
            };
        });
    });

    console.log("\nScripts in the selected frame:");
    const decodedUrl = scripts.flatMap((script: any, index: number) => {


        if (script.textContent?.includes("window.atob")) {
            console.log("Found atob:", script.textContent);
        }
        const REGEX = /window\.atob\(['"](.*?)['"]\)/;
        const match = script.textContent?.match(REGEX);
        if (match) {
            console.log("Found source:", match[1]);
            const decodedUrl = atob(match[1]);
            console.log("Decoded URL:", decodedUrl);
            return [decodedUrl];
        }
        return [];
    })[0];

    if (!decodedUrl) {
        console.error("No decoded URL found");
        process.exit(1);
    }

    const response = await axios.get(decodedUrl, {
        maxRedirects: 0, // Don't follow redirects
        validateStatus: (status: number) => status >= 200 && status < 400,
    });

    const playlistUrl = response.headers.location;

    const FILE = [
        "#EXTM3U",
        "#EXTINF: -1,",
        "#EXTVLCOPT:http-referrer=https://googlapisapi.com/",
        playlistUrl
    ]
    const m3u8 = FILE.join("\n");
    fs.writeFileSync("playlist.m3u8", m3u8);


    await browser.close();

    console.log(`${__dirname}/playlist.m3u8`);


    console.log("Opening in VLC");
    exec(`/Applications/VLC.app/Contents/MacOS/VLC ${__dirname}/playlist.m3u8`);
    process.exit(0);
}

const filter = process.argv[2];

main({
    filter: filter || "*",
});