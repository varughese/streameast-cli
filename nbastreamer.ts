const { exec } = require("child_process");
const { chromium } = require("playwright");

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
            const text = $(element).text().trim().replace(/\n+/g, " "); // Extract text inside the link

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

(async () => {
    const nbaLinks = (await fetchStreamEastLinks()) || [];
    console.log("Found:");
    nbaLinks?.forEach((l) => console.log("\t >" + l.text));

    console.log("\nPicking " + nbaLinks[0].text + "\n" + nbaLinks[0].link);
    const nbaLink = nbaLinks[0].link;

    const browser = await chromium.launch({
        headless: true,
        executablePath: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    }); // Set to false to see the browser actions
    const context = await browser.newContext();
    const page = await context.newPage();

    // Navigate to the website
    await page.goto(nbaLink);

    // Optional: Handle popups or advertisements
    // This is a simple example; you might need more complex handling depending on the popups
    page.on("popup", async (popup) => {
        await popup.close();
    });

    // Wait for the play button within .play-wrapper to be available and click it
    await page.waitForSelector(".play-wrapper");

    // Detect and remove the element intercepting pointer events
    await page.evaluate(() => {
        // Get the bounding box of the element we want to click
        const playWrapper = document.querySelector(".play-wrapper");
        if (playWrapper) {
            const rect = playWrapper.getBoundingClientRect();
            // Find the topmost element at the center of the playWrapper
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            const elementAtPoint = document.elementFromPoint(x, y);
            if (elementAtPoint && elementAtPoint !== playWrapper) {
                // Hide or remove the intercepting element
                elementAtPoint.remove();
            }
        }
    });

    await page.click(".play-wrapper");

    // Wait for the video element to load the blob source and start playing
    await page.waitForSelector('video[src^="blob:"]', { timeout: 60000 });

    const m3u8Url = await new Promise(async (resolve) => {
        page.on("request", (request) => {
            const url: string = request.url();
            if (url.endsWith(".m3u8")) {
                resolve(url);
            }
        });
    });

    if (m3u8Url !== "ERROR") {
        console.log("Found streaming video url:", m3u8Url);
    } else {
        console.log("M3U8 URL not found");
    }

    await browser.close();

    console.log("Opening in VLC");
    exec(`/Applications/VLC.app/Contents/MacOS/VLC ${m3u8Url}`);
    process.exit(0);
})();
