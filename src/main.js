import { writeFileSync } from "fs";
import winston from "winston";
import { ECourtsScraper } from "./ECourtsScraper.js";
import { Database } from "./database.js";

// Configure logging
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} - ${level.toUpperCase()} - ${message}`;
    })
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

function saveFailedCases(failedCases) {
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "")
    .split("T")
    .join("_")
    .slice(0, -4);
  const filename = `failed_cases_${timestamp}.json`;
  writeFileSync(filename, JSON.stringify(failedCases, null, 4));
  return filename;
}

function generateCNRNumber(startNumber, year = "2019") {
  const prefix = "KLKN01";
  const paddedNumber = String(startNumber).padStart(6, "0");
  return `${prefix}${paddedNumber}${year}`;
}

async function main() {
  const startNumber = 1;
  const endNumber = 10000;
  const cnrNumbers = [];

  for (let i = startNumber; i <= endNumber; i++) {
    cnrNumbers.push(generateCNRNumber(i));
  }

  logger.info("CNR numbers to process:");
  logger.info(cnrNumbers.join(", "));

  const startTime = new Date();
  const failedCases = [];
  const successfulCases = [];
  const nonExistentCases = [];

  // Initialize database and scraper
  const db = new Database();
  const scraper = new ECourtsScraper(db);

  try {
    for (const cnrNumber of cnrNumbers) {
      const caseStart = new Date();

      try {
        const caseDetails = await scraper.getCaseDetails(cnrNumber);
        if (caseDetails) {
          if (!caseDetails.exists) {
            nonExistentCases.push(cnrNumber);
            logger.info(`✓ Case ${cnrNumber} does not exist`);
          } else {
            try {
              await db.insertCase(caseDetails);
              successfulCases.push(cnrNumber);
              logger.info(`✓ Successfully scraped and saved case ${cnrNumber}`);
              // Log some basic case details
              logger.info(`Case Type: ${caseDetails.caseType || "N/A"}`);
              logger.info(
                `Filing Number: ${caseDetails.filingNumber || "N/A"}`
              );
              logger.info(
                `Decision Date: ${caseDetails.decisionDate || "N/A"}`
              );
            } catch (error) {
              failedCases.push({
                cnrNumber: cnrNumber,
                error: "Failed to save to database",
                timestamp: new Date().toISOString(),
              });
              logger.error(`✗ Failed to save case ${cnrNumber} to database`);
            }
          }
        } else {
          failedCases.push({
            cnrNumber: cnrNumber,
            error: "Failed to scrape case details",
            timestamp: new Date().toISOString(),
          });
          logger.error(`✗ Failed to scrape case ${cnr}`);
        }
      } catch (error) {
        failedCases.push({
          cnrNumber: cnrNumber,
          error: error.message,
          timestamp: new Date().toISOString(),
        });
        logger.error(`✗ Error processing case ${cnrNumber}: ${error.message}`);
      }

      const caseTime = (new Date() - caseStart) / 1000;
      logger.info(`Time taken: ${caseTime.toFixed(2)} seconds`);

      // Small delay between cases to prevent overloading
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // Final summary
    const totalTime = (new Date() - startTime) / 1000;

    logger.info(`
=== Final Summary ===
Total runtime: ${Math.floor(totalTime / 60)}m ${Math.floor(totalTime % 60)}s
Successfully scraped: ${successfulCases.length}
Non-existent cases: ${nonExistentCases.length}
Failed cases: ${failedCases.length}

Successful CNRs:
${successfulCases.map((cnr) => `- ${cnr}`).join("\n")}

Non-existent CNRs:
${nonExistentCases.map((cnr) => `- ${cnr}`).join("\n")}

Failed CNRs:
${failedCases.map((c) => `- ${c.cnrNumber}: ${c.error}`).join("\n")}
`);

    // Save failed cases to file
    if (failedCases.length > 0) {
      const failedCasesFile = saveFailedCases(failedCases);
      logger.info(`Failed cases saved to: ${failedCasesFile}`);
    }

    // Cleanup
    await scraper.cleanup();
    await db.cleanup();
  } catch (error) {
    logger.error(`Error during scraping: ${error.message}`);
  }
}

// Handle unhandled promise rejections
process.on("unhandledRejection", (error) => {
  logger.error("Unhandled Promise Rejection:", error);
  process.exit(1);
});

// Handle SIGINT (Ctrl+C)
process.on("SIGINT", () => {
  logger.info("\nScraping interrupted by user");
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  logger.error("Error in main:", error);
  process.exit(1);
});
