import axios from "axios";
import { fileURLToPath } from "url";
import { writeFileSync } from "fs";
import { load } from "cheerio";
import FormData from "form-data";
import Jimp from "jimp";
import tesseract from "node-tesseract-ocr";
import { Database } from "./database.js";
import { CookieJar } from "tough-cookie";
import { wrapper } from "axios-cookiejar-support";
import winston from "winston";
import { SocksProxyAgent } from "socks-proxy-agent";
class ECourtsScraper {
  constructor(db = null) {
    this.proxyAgent = new SocksProxyAgent("socks5h://127.0.0.1:9050");

    this.baseUrl = "https://services.ecourts.gov.in/ecourtindia_v6/";
    this.cookieJar = new CookieJar();
    this.session = wrapper(
      axios.create({
        jar: this.cookieJar,
        httpAgent: this.proxyAgent,
        httpsAgent: this.proxyAgent,
        timeout: 30000,
      })
    );
    this.db = db || new Database();
    this.appToken = null;

    // Initialize logger with more detailed format
    this.logger = winston.createLogger({
      level: "info",
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
          return `${timestamp} - ${level.toUpperCase()} - ${message}${
            stack ? "\n" + stack : ""
          }`;
        })
      ),
      transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: "error.log", level: "error" }),
        new winston.transports.File({ filename: "combined.log" }),
      ],
    });

    // Initialize components
    this.setupSession();
    this.initializeDatabase();
  }

  setupSession() {
    this.session.defaults.headers.common = {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Accept-Language": "en-US,en;q=0.9",
      "X-Requested-With": "XMLHttpRequest",
      Connection: "keep-alive",
      Referer: this.baseUrl,
    };
    this.logger.info("Session setup successful");
  }

  async initializeDatabase() {
    try {
      await this.db.initialize();
      this.logger.info("Database initialized successfully");
    } catch (error) {
      this.logger.error("Failed to initialize database:", error);
      // Don't throw here, just log the error
    }
  }

  async getAppTokenAndCaptcha(maxRetries = 3) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // First get the main page to get cookies and app token
        const response = await this.session.get(this.baseUrl);

        // Extract app token
        if (response.data.includes("app_token")) {
          const tokenStart =
            response.data.indexOf("app_token") + "app_token".length + 2;
          const tokenEnd = response.data.indexOf('"', tokenStart);
          this.appToken = response.data.slice(tokenStart, tokenEnd);
          this.logger.info("Successfully retrieved new app token");

          // Get CAPTCHA directly
          const captchaUrl = new URL(
            "vendor/securimage/securimage_show.php",
            this.baseUrl
          ).toString();
          const captchaResponse = await this.session.post(captchaUrl, null, {
            httpsAgent: this.proxyAgent,
            headers: {
              Referer: this.baseUrl,
              Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
              "Accept-Language": "en-US,en;q=0.9",
              Connection: "keep-alive",
              "Sec-Fetch-Site": "same-origin",
              "Sec-Fetch-Mode": "no-cors",
              "Sec-Fetch-Dest": "image",
            },
            responseType: "arraybuffer",
          });

          if (
            captchaResponse.status === 200 &&
            captchaResponse.headers["content-type"].startsWith("image/")
          ) {
            // Save original image for debugging
            const imageBuffer = Buffer.from(captchaResponse.data);
            writeFileSync("last_captcha_original.png", imageBuffer);

            // Process image with Jimp
            const image = await Jimp.read(imageBuffer);

            // Enhanced image processing pipeline
            image
              .grayscale()
              .contrast(0.8)
              .brightness(0.2)
              .invert()
              .scale(2)
              .normalize();

            // Save processed image
            await image.writeAsync("last_captcha_processed.png");

            // Wait for file to be written
            await new Promise((resolve) => setTimeout(resolve, 100));

            // Try different OCR configurations
            const configs = [
              {
                lang: "eng",
                oem: 3,
                psm: 7,
                tessedit_char_whitelist:
                  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
              },
              {
                lang: "eng",
                oem: 3,
                psm: 8,
                tessedit_char_whitelist:
                  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
              },
              {
                lang: "eng",
                oem: 3,
                psm: 13,
                tessedit_char_whitelist:
                  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
              },
            ];

            // Try each configuration
            for (const config of configs) {
              try {
                const captchaText = await tesseract.recognize(
                  "last_captcha_processed.png",
                  config
                );
                const cleanedText = captchaText
                  .trim()
                  .replace(/[^0-9A-Za-z]/g, "");

                if (
                  cleanedText &&
                  cleanedText.length >= 4 &&
                  cleanedText.length <= 8
                ) {
                  this.logger.info(
                    `Successfully extracted CAPTCHA text: ${cleanedText}`
                  );
                  return { success: true, captchaText: cleanedText };
                }
              } catch (ocrError) {
                this.logger.error("OCR error with config:", config, ocrError);
                continue;
              }
            }

            this.logger.error(
              "Failed to get valid CAPTCHA text with any configuration"
            );
          } else {
            this.logger.error(
              `Failed to get CAPTCHA image: HTTP ${captchaResponse.status}`
            );
          }
        } else {
          this.logger.error("Could not find app token in page");
        }
      } catch (error) {
        this.logger.error(
          `Failed to get app token and CAPTCHA (attempt ${
            attempt + 1
          }/${maxRetries}):`,
          error.message
        );
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    return { success: false, captchaText: null };
  }

  async extractCaptchaText() {
    try {
      // Get CAPTCHA image
      const captchaUrl = new URL(
        "vendor/securimage/securimage_show.php",
        this.baseUrl
      ).toString();
      const captchaResponse = await this.session.post(captchaUrl, null, {
        httpsAgent: this.proxyAgent,
        headers: {
          Referer: this.baseUrl,
          Accept: "image/webp,image/apng,image/*,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          Connection: "keep-alive",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "no-cors",
          "Sec-Fetch-Dest": "image",
        },
        responseType: "arraybuffer",
      });

      if (captchaResponse.status !== 200) {
        this.logger.error(
          `Failed to get CAPTCHA image: HTTP ${captchaResponse.status}`
        );
        return null;
      }

      if (!captchaResponse.headers["content-type"].startsWith("image/")) {
        this.logger.error("Response is not an image");
        return null;
      }

      // Process CAPTCHA image
      const imageBuffer = Buffer.from(captchaResponse.data);
      const image = await Jimp.read(imageBuffer);

      // Save original for debugging
      await image.writeAsync("last_captcha_original.png");

      // Enhanced image processing
      image
        .grayscale() // Convert to grayscale
        .contrast(1) // Increase contrast
        .brightness(0.5) // Increase brightness
        .invert() // Invert colors
        .scale(2); // Scale up for better OCR

      // Save processed image for debugging
      await image.writeAsync("last_captcha_processed.png");

      // OCR with different PSM modes
      const psmModes = [7, 8, 13]; // Different page segmentation modes to try
      for (const psm of psmModes) {
        const config = {
          lang: "eng",
          oem: 3,
          psm: psm,
          tessedit_char_whitelist:
            "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
        };

        try {
          const captchaText = await tesseract.recognize(
            "last_captcha_processed.png",
            config
          );
          const cleanedText = captchaText.trim().replace(/[^0-9A-Za-z]/g, "");

          if (cleanedText && cleanedText.length >= 4) {
            this.logger.info(
              `Successfully extracted CAPTCHA text with PSM ${psm}: ${cleanedText}`
            );
            return cleanedText;
          }
        } catch (error) {
          this.logger.error(`OCR error with PSM ${psm}:`, error);
          continue;
        }
      }

      this.logger.warn(
        "Failed to extract valid CAPTCHA text with any PSM mode"
      );
      return null;
    } catch (error) {
      this.logger.error("Error processing CAPTCHA:", error);
      return null;
    }
  }

  async fetchCaseHistory(cnr) {
    try {
      if (!this.appToken) {
        const { success } = await this.getAppTokenAndCaptcha();
        if (!success) {
          this.logger.error("Failed to get initial app token");
          return null;
        }
      }

      // Parse CNR number to get required parameters
      const courtCode = cnr.slice(4, 6);
      const stateCode = cnr.slice(2, 4);
      const nationalCourtCode = cnr.slice(0, 6);

      // First get the case details to extract establishment code
      const searchUrl = new URL(
        "?p=cnr_status/searchByCNR",
        this.baseUrl
      ).toString();
      const data = {
        cino: cnr,
        ajax_req: "true",
        app_token: this.appToken,
      };

      // Get a fresh token for history request
      await this.getAppTokenAndCaptcha();

      // Then fetch case history
      const historyUrl = new URL(
        "?p=home/viewBusiness",
        this.baseUrl
      ).toString();
      const historyData = {
        establishment_code: nationalCourtCode,
        court_code: courtCode,
        state_code: stateCode,
        dist_code: nationalCourtCode.slice(2, 4),
        case_number1: cnr,
        disposal_flag: "DisposedP",
        national_court_code: nationalCourtCode,
        court_no: "1",
        search_by: "cnr",
        srno: "1",
        ajax_req: "true",
        app_token: this.appToken,
        cino: cnr,
        business_type: "case_history",
        case_type: "EP", // Default to EP since most cases are EP
        case_no: cnr.slice(6), // Extract case number from CNR
        year: "20" + cnr.slice(-4), // Extract year from CNR
        state_name: "Kerala", // Hardcode for now since all cases are from Kerala
        dist_name: "KANNUR", // Hardcode for now since all cases are from Kannur
        court_name: "Munsiffss Court Kuthuparamba", // Hardcode for now
        business_flag: "true",
        business_type_flag: "true",
        business_date: new Date().toLocaleDateString("en-GB"), // DD-MM-YYYY format
      };

      const headers = {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest",
        Accept: "application/json, text/javascript, */*; q=0.01",
        Referer: this.baseUrl + "?p=cnr_status/searchByCNR",
        Origin: "https://services.ecourts.gov.in",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      };

      // First make a GET request to set up session
      await this.session.get(this.baseUrl + "?p=home/business");

      // Then make the POST request for history
      const response = await this.session.post(historyUrl, historyData, {
        headers,
      });
      this.logger.debug(`History response status: ${response.status}`);
      this.logger.debug(
        `History response content: ${JSON.stringify(response.data).slice(
          0,
          500
        )}`
      );

      if (response.status === 200) {
        const historyData = response.data;
        if (
          historyData &&
          typeof historyData === "object" &&
          !historyData.errormsg
        ) {
          this.logger.info(`Successfully fetched history for CNR ${cnr}`);
          return historyData;
        } else {
          this.logger.warn(
            `Error in history response: ${
              historyData?.errormsg || "Unknown error"
            }`
          );
        }
      } else {
        this.logger.error(
          `HTTP ${response.status} error for history of CNR ${cnr}`
        );
      }
      return null;
    } catch (error) {
      this.logger.error(
        `Error fetching case history for ${cnr}:`,
        error.message
      );
      return null;
    }
  }

  parseHtml(html) {
    try {
      const $ = load(html);

      // Check if case does not exist
      if ($('span:contains("This Case Code does not exists")').length > 0) {
        this.logger.info("Case does not exist");
        return null;
      }

      // Check if the page contains case details
      if (!html.includes("Case Details")) {
        this.logger.error("No case details found in the response");
        return null;
      }

      const caseDetails = {
        htmlContent: html,
        cnrNumber: null,
        caseType: null,
        filingNumber: null,
        filingDate: null,
        registrationNumber: null,
        registrationDate: null,
        caseStatus: null,
        disposalNature: null,
        disposalDate: null,
        decisionDate: null,
        courtNumberAndJudge: null,
        petitionerName: null,
        petitionerAdvocate: null,
        respondentName: null,
        respondentAdvocate: null,
        underActs: null,
        underSections: null,
        firstHearingDate: null,
        caseHistory: [],
        transferDetails: [],
        iaDetails: [],
      };

      // Parse case details table
      $(".case_details_table tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 2) {
          const label = $(cols[0]).text().trim().toLowerCase();
          if (label.includes("case type")) {
            caseDetails.caseType = $(cols[1]).text().trim();
            this.logger.debug(`Found case type: ${caseDetails.caseType}`);
          } else if (label.includes("filing number")) {
            caseDetails.filingNumber = $(cols[1]).text().trim();
            if (cols.length >= 4) {
              caseDetails.filingDate = $(cols[3]).text().trim();
            }
            this.logger.debug(
              `Found filing number: ${caseDetails.filingNumber}, date: ${caseDetails.filingDate}`
            );
          } else if (label.includes("registration number")) {
            caseDetails.registrationNumber = $(cols[1]).text().trim();
            if (cols.length >= 4) {
              caseDetails.registrationDate = $(cols[3]).text().trim();
            }
            this.logger.debug(
              `Found registration number: ${caseDetails.registrationNumber}, date: ${caseDetails.registrationDate}`
            );
          } else if (label.includes("cnr number")) {
            const cnrText = $(cols[1]).text().trim();
            caseDetails.cnrNumber = cnrText.substring(0, 16);
            this.logger.debug(`Found CNR number: ${caseDetails.cnrNumber}`);
          }
        }
      });

      // Parse case status table
      $(".case_status_table tr").each((_, row) => {
        const cols = $(row).find("td");
        if (cols.length >= 2) {
          const label = $(cols[0]).text().trim().toLowerCase();
          if (label.includes("first hearing date")) {
            caseDetails.firstHearingDate = $(cols[1]).text().trim();
            this.logger.debug(
              `Found first hearing date: ${caseDetails.firstHearingDate}`
            );
          } else if (label.includes("decision date")) {
            const decisionDate = $(cols[1]).text().trim();
            caseDetails.decisionDate = decisionDate;
            if (caseDetails.caseStatus === "Case disposed") {
              caseDetails.disposalDate = decisionDate;
            }
            this.logger.debug(`Found decision date: ${decisionDate}`);
          } else if (label.includes("case status")) {
            caseDetails.caseStatus = $(cols[1]).text().trim();
            this.logger.debug(`Found case status: ${caseDetails.caseStatus}`);
          } else if (label.includes("nature of disposal")) {
            caseDetails.disposalNature = $(cols[1]).text().trim();
            this.logger.debug(
              `Found disposal nature: ${caseDetails.disposalNature}`
            );
          } else if (label.includes("court number and judge")) {
            caseDetails.courtNumberAndJudge = $(cols[1]).text().trim();
            this.logger.debug(
              `Found court number and judge: ${caseDetails.courtNumberAndJudge}`
            );
          }
        }
      });

      // Parse petitioner and advocate details
      $(".Petitioner_Advocate_table tr").each((_, row) => {
        const text = $(row).find("td").first().text().trim();
        const parts = text.split("Advocate-");
        if (parts.length >= 2) {
          caseDetails.petitionerName = parts[0].trim();
          caseDetails.petitionerAdvocate = parts[1].trim();
          this.logger.debug(
            `Found petitioner: ${caseDetails.petitionerName}, advocate: ${caseDetails.petitionerAdvocate}`
          );
        } else {
          caseDetails.petitionerName = text;
          this.logger.debug(
            `Found petitioner only: ${caseDetails.petitionerName}`
          );
        }
      });

      // Parse respondent and advocate details
      $(".Respondent_Advocate_table tr").each((_, row) => {
        const text = $(row).find("td").first().text().trim();
        const parts = text.split("Advocate-");
        if (parts.length >= 2) {
          caseDetails.respondentName = parts[0].trim();
          caseDetails.respondentAdvocate = parts[1].trim();
          this.logger.debug(
            `Found respondent: ${caseDetails.respondentName}, advocate: ${caseDetails.respondentAdvocate}`
          );
        } else {
          caseDetails.respondentName = text;
          this.logger.debug(
            `Found respondent only: ${caseDetails.respondentName}`
          );
        }
      });

      // Parse acts and sections
      const acts = [];
      const sections = [];
      $(".acts_table tr")
        .slice(1)
        .each((_, row) => {
          const cols = $(row).find("td");
          if (cols.length >= 2) {
            const act = $(cols[0]).text().trim();
            const section = $(cols[1]).text().trim();
            if (act) acts.push(act);
            if (section) sections.push(section);
          }
        });

      if (acts.length) {
        caseDetails.underActs = acts.join(", ");
        this.logger.debug(`Found acts: ${caseDetails.underActs}`);
      }
      if (sections.length) {
        caseDetails.underSections = sections.join(", ");
        this.logger.debug(`Found sections: ${caseDetails.underSections}`);
      }

      // Parse case history
      $(".history_table tr")
        .slice(1)
        .each((_, row) => {
          const cols = $(row).find("td");
          if (cols.length >= 4) {
            const historyEntry = {
              judge: $(cols[0]).text().trim(),
              businessDate: $(cols[1]).text().trim().split("\n")[0],
              hearingDate: $(cols[2]).text().trim(),
              purpose: $(cols[3]).text().trim(),
            };
            if (Object.values(historyEntry).some((val) => val)) {
              caseDetails.caseHistory.push(historyEntry);
            }
          }
        });
      this.logger.debug(
        `Found ${caseDetails.caseHistory.length} history entries`
      );

      // Parse transfer details
      $(".transfer_table tr")
        .slice(1)
        .each((_, row) => {
          const cols = $(row).find("td");
          if (cols.length >= 4) {
            caseDetails.transferDetails.push({
              registrationNumber: $(cols[0]).text().trim(),
              transferDate: $(cols[1]).text().trim(),
              fromCourt: $(cols[2]).text().trim(),
              toCourt: $(cols[3]).text().trim(),
            });
          }
        });
      this.logger.debug(
        `Found ${caseDetails.transferDetails.length} transfer entries`
      );

      // Parse IA details
      $(".IAheading tr")
        .slice(1)
        .each((_, row) => {
          const cols = $(row).find("td");
          if (cols.length >= 5) {
            const nextDatePurpose = $(cols[3]).text().trim().split("\n");
            const nextDate = nextDatePurpose[0]?.trim();
            const purpose = nextDatePurpose[1]?.replace(/[()]/g, "").trim();

            const partyText = $(cols[1]).text().trim();
            const partyName = partyText.split("\n")[0] || partyText;

            caseDetails.iaDetails.push({
              iaNo: $(cols[0]).text().trim(),
              party: partyName,
              dtFiling: $(cols[2]).text().trim(),
              nextDate,
              purpose,
              iaStatus: $(cols[4]).text().trim(),
              classification: purpose || "General",
              dtReg: $(cols[2]).text().trim(),
              status: "Online",
            });
          }
        });
      this.logger.debug(`Found ${caseDetails.iaDetails.length} IA entries`);

      // Validate required fields
      if (!caseDetails.cnrNumber) {
        this.logger.error("Missing required field: CNR number");
        return null;
      }

      this.logger.info("Successfully parsed case details");
      return caseDetails;
    } catch (error) {
      this.logger.error("Error parsing case details:", error);
      return null;
    }
  }

  async getCaseDetails(cnr, maxAttempts = 1) {
    if (!this.appToken) {
      const { success } = await this.getAppTokenAndCaptcha();
      if (!success) {
        this.logger.error("Failed to get initial app token");
        return null;
      }
    }

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        this.logger.info(
          `Attempt ${attempt + 1}/${maxAttempts} for CNR ${cnr}`
        );

        // Get fresh token and CAPTCHA
        const { success, captchaText } = await this.getAppTokenAndCaptcha();
        if (!success || !captchaText) {
          this.logger.warn(
            `Failed to get app token or CAPTCHA on attempt ${attempt + 1}`
          );
          continue;
        }

        this.logger.info(`Using CAPTCHA text: ${captchaText}`);

        // Make initial request to set up session
        await this.session.get(this.baseUrl);

        // Prepare request data
        const data = new URLSearchParams();
        data.append("cino", cnr);
        data.append("fcaptcha_code", captchaText);
        data.append("ajax_req", "true");
        data.append("app_token", this.appToken);

        // Make request with detailed logging
        this.logger.info(
          `Sending request with data: ${JSON.stringify({
            cino: cnr,
            fcaptcha_code: captchaText,
            ajax_req: "true",
            app_token: this.appToken,
          })}`
        );

        const searchUrl = new URL(
          "?p=cnr_status/searchByCNR",
          this.baseUrl
        ).toString();
        const response = await this.session.post(searchUrl, data, {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            Accept: "application/json, text/javascript, */*; q=0.01",
            Origin: "https://services.ecourts.gov.in",
            Referer: this.baseUrl + "?p=cnr_status/searchByCNR",
            "Sec-Fetch-Site": "same-origin",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Dest": "empty",
          },
        });

        this.logger.info(`Response status: ${response.status}`);

        if (response.status === 200) {
          try {
            const result = response.data;
            if (result.errormsg) {
              this.logger.warn(
                `Error in response (attempt ${attempt + 1}): ${result.errormsg}`
              );
              // Save failed response for debugging
              continue;
            }

            // Save HTML response for debugging
            const htmlContent = result.casetype_list || "";
            writeFileSync("last_response.html", htmlContent);
            this.logger.info("Saved HTML response to last_response.html");

            // Check if case exists
            if (htmlContent.includes("This Case Code does not exists")) {
              this.logger.info(`Case ${cnr} does not exist`);
              return { cnrNumber: cnr, exists: false };
            }

            // Parse case details from HTML response
            const caseDetails = this.parseHtml(htmlContent);
            if (caseDetails) {
              caseDetails.exists = true;
              this.logger.info(
                `Successfully fetched data for CNR ${cnr} on attempt ${
                  attempt + 1
                }`
              );
              return caseDetails;
            } else {
              this.logger.warn(
                `Failed to parse case details from response on attempt ${
                  attempt + 1
                }`
              );
            }
          } catch (error) {
            this.logger.error(
              `Error parsing response on attempt ${attempt + 1}:`,
              error
            );
            continue;
          }
        } else {
          this.logger.error(
            `HTTP ${response.status} error on attempt ${attempt + 1}`
          );
        }
      } catch (error) {
        this.logger.error(`Request error on attempt ${attempt + 1}:`, error);
        continue;
      }

      // Add delay between attempts
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    this.logger.error(
      `Failed to fetch case details for ${cnr} after ${maxAttempts} attempts`
    );
    return null;
  }

  async run(cnrNumbers) {
    const results = [];
    const totalCases = cnrNumbers.length;
    let successfulCases = 0;
    let failedCases = 0;

    this.logger.info(`Starting to scrape ${totalCases} cases...`);

    // Ensure database is initialized
    if (!this.db.initialized) {
      try {
        await this.db.initialize();
        this.logger.info("Database initialized successfully");
      } catch (error) {
        this.logger.error("Failed to initialize database:", error);
        this.logger.warn(
          "Will continue scraping but will not save to database"
        );
      }
    }

    // Validate database connection
    if (!this.db.connection) {
      this.logger.warn(
        "Database connection not available. Will not save cases to database."
      );
    }

    for (let idx = 0; idx < cnrNumbers.length; idx++) {
      const cnr = cnrNumbers[idx];
      this.logger.info(`Processing case ${idx + 1}/${totalCases}: ${cnr}`);

      try {
        const caseDetails = await this.getCaseDetails(cnr);

        if (!caseDetails) {
          failedCases++;
          this.logger.warn(`Case ${cnr} returned null details`);
          continue;
        }

        if (caseDetails.exists === false) {
          failedCases++;
          this.logger.warn(`Case ${cnr} does not exist in the system`);
          continue;
        }

        successfulCases++;
        results.push(caseDetails);

        // Only attempt database save if we have a valid case and database connection
        if (this.db.connection) {
          try {
            await this.db.insertCase(caseDetails);
            this.logger.info(`Successfully saved case ${cnr} to database`);
          } catch (error) {
            this.logger.error(
              `Failed to store case ${cnr} in database:`,
              error.message
            );
            failedCases++;
          }
        } else {
          this.logger.warn(
            `Database connection not available, skipping save for case ${cnr}`
          );
        }

        // Add delay between cases
        if (idx < totalCases - 1) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      } catch (error) {
        failedCases++;
        this.logger.error(`Error processing case ${cnr}:`, error.message);
      }
    }

    // Print summary
    this.logger.info(`\n=== Scraping Summary ===`);
    this.logger.info(`Total cases: ${totalCases}`);
    this.logger.info(`Successful: ${successfulCases}`);
    this.logger.info(`Failed: ${failedCases}`);

    // Print scraped data in a readable format
    if (results.length > 0) {
      this.logger.info(`\n=== Scraped Case Details ===`);
      for (const case_ of results) {
        this.logger.info(`\nCase CNR: ${case_.cnrNumber}`);
        this.logger.info("-".repeat(50));
        for (const [key, value] of Object.entries(case_).sort()) {
          if (value !== null && !["createdAt", "updatedAt"].includes(key)) {
            this.logger.info(`${key}: ${value}`);
          }
        }
      }
    }

    return results;
  }

  cleanup() {
    // Nothing to clean up in Node.js version as axios handles connection cleanup
  }
}

export { ECourtsScraper };
