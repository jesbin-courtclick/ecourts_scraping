import mysql from 'mysql2/promise';
import winston from 'winston';
import fs from 'fs';
import moment from 'moment';
import fsPromises from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export class Database {
    constructor() {
        this.connection = null;
        this.initialized = false;
        this.setupLogging();
    }

    setupLogging() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.json()
            ),
            transports: [
                new winston.transports.Console(),
                new winston.transports.File({ filename: 'error.log', level: 'error' }),
                new winston.transports.File({ filename: 'combined.log' })
            ]
        });
    }

    async initialize() {
        if (this.initialized) return;

        try {
            // Create connection
            this.connection = await mysql.createConnection({
                host: 'localhost',
                user: 'root',
                password: '',
                database: 'ecourts_db_jesbin'
            });

            // Read and execute schema
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename);
            const schemaPath = path.join(__dirname, 'schema.sql');
            const schema = await fsPromises.readFile(schemaPath, 'utf8');

            // Split schema into individual statements
            const statements = schema
                .split(';')
                .map(statement => statement.trim())
                .filter(statement => statement.length > 0);

            // Execute each statement
            for (const statement of statements) {
                try {
                    // Replace INSERT INTO with INSERT IGNORE INTO for categories
                    const modifiedStatement = statement.replace(
                        /INSERT INTO categories/,
                        'INSERT IGNORE INTO categories'
                    );
                    await this.connection.execute(modifiedStatement);
                } catch (error) {
                    // Ignore "table already exists" errors
                    if (error.errno === 1050) {
                        continue;
                    }
                    // Ignore duplicate entry errors for categories
                    if (error.errno === 1062 && error.message.includes('categories.PRIMARY')) {
                        continue;
                    }
                    throw error;
                }
            }

            console.log('Database tables created successfully');
            this.initialized = true;
        } catch (error) {
            console.error('Error initializing database:', error);
            throw error;
        }
    }

    parseDate(dateStr) {
        if (!dateStr) return null;

        // Convert to string if needed
        if (typeof dateStr === 'number') {
            dateStr = String(dateStr);
        } else if (typeof dateStr !== 'string') {
            try {
                dateStr = String(dateStr);
            } catch {
                return null;
            }
        }

        // Remove ordinal indicators and clean the string
        dateStr = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1').trim();

        const formats = [
            'DD-MM-YYYY',
            'DD/MM/YYYY',
            'YYYY-MM-DD',
            'DD MMMM YYYY',
            'DD-MMM-YYYY'
        ];

        for (const format of formats) {
            const parsed = moment(dateStr, format, true);
            if (parsed.isValid()) {
                return parsed.format('YYYY-MM-DD');
            }
        }
        return null;
    }

    async getOrCreateCaseType(caseType) {
        if (!caseType) return null;

        const parts = caseType.split(' - ');
        const shortForm = parts[0].trim();
        const expandedForm = parts.length > 1 ? parts[1].trim() : null;

        await this.connection.execute(
            'INSERT IGNORE INTO case_types (short_form, expanded_form) VALUES (?, ?)',
            [shortForm, expandedForm]
        );

        const [rows] = await this.connection.execute(
            'SELECT id FROM case_types WHERE short_form = ?',
            [shortForm]
        );
        return rows.length ? rows[0].id : null;
    }

    cleanLitigantName(name) {
        if (!name) return null;

        if (typeof name === 'number') {
            name = String(name);
        } else if (typeof name !== 'string') {
            try {
                name = String(name);
            } catch {
                return null;
            }
        }

        // Remove number prefix pattern
        name = name.replace(/^\d+[\s)]+/, '');

        // Remove special characters and extra whitespace
        const cleaned = name.replace(/[^\w\s]/g, ' ').trim();
        return cleaned || null;
    }

    async getOrCreateStateDistrict(cnrNumber) {
        const stateName = "Kerala"; // Static for now
        const districtName = "Kannur"; // Static for now

        // Insert state
        await this.connection.execute(
            'INSERT IGNORE INTO states (name, created_at, updated_at) VALUES (?, NOW(), NOW())',
            [stateName]
        );

        // Get state ID
        const [stateRows] = await this.connection.execute(
            'SELECT id FROM states WHERE name = ?',
            [stateName]
        );
        const stateId = stateRows[0].id;

        // Insert district
        await this.connection.execute(
            'INSERT IGNORE INTO districts (name, state_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
            [districtName, stateId]
        );

        // Get district ID
        const [districtRows] = await this.connection.execute(
            'SELECT id FROM districts WHERE name = ?',
            [districtName]
        );
        const districtId = districtRows[0].id;

        return [stateId, districtId];
    }

    async getOrCreateCourt(courtName, stateId, districtId) {
        if (!courtName) return null;

        const categoryId = 3; // Category ID for District Courts

        await this.connection.execute(
            'INSERT IGNORE INTO courts (name, state_id, district_id, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, NOW(), NOW())',
            [courtName, stateId, districtId, categoryId]
        );

        const [rows] = await this.connection.execute(
            'SELECT id FROM courts WHERE name = ? AND state_id = ? AND district_id = ?',
            [courtName, stateId, districtId]
        );
        return rows.length ? rows[0].id : null;
    }

    async getOrCreateCourtHall(courtNumberAndJudge, courtId) {
        if (!courtNumberAndJudge) return [null, null];

        const match = courtNumberAndJudge.match(/(\d+)\s*-\s*(.+)/);
        if (match) {
            const courtHallNumber = match[1];
            const judgeName = match[2].trim();

            await this.connection.execute(
                'INSERT IGNORE INTO court_halls (name, court_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                [courtHallNumber, courtId]
            );

            const [rows] = await this.connection.execute(
                'SELECT id FROM court_halls WHERE name = ? AND court_id = ?',
                [courtHallNumber, courtId]
            );
            return [rows.length ? rows[0].id : null, judgeName];
        }
        return [null, null];
    }

    async getOrCreateLitigant(name) {
        if (!name) return null;

        try {
            const cleanedName = this.cleanLitigantName(name);
            if (!cleanedName) return null;

            const [rows] = await this.connection.execute(
                'SELECT id FROM litigants WHERE litigant_name = ?',
                [cleanedName]
            );

            if (rows.length) {
                return rows[0].id;
            }

            const [result] = await this.connection.execute(
                'INSERT INTO litigants (litigant_name) VALUES (?)',
                [cleanedName]
            );
            return result.insertId;

        } catch (error) {
            this.logger.error('Error in getOrCreateLitigant:', error);
            return null;
        }
    }

    async getOrCreateAdvocate(name) {
        if (!name) return null;

        await this.connection.execute(
            'INSERT IGNORE INTO advocates (advocate_name) VALUES (?)',
            [name]
        );

        const [rows] = await this.connection.execute(
            'SELECT id FROM advocates WHERE advocate_name = ?',
            [name]
        );
        return rows.length ? rows[0].id : null;
    }

    async getOrCreateAct(actName) {
        if (!actName) return null;

        actName = actName.trim().replace(/\\$/, '').trim();

        const parts = actName.split(',').map(part => part.trim());
        if (parts.length > 1 && /^\d+$/.test(parts[1])) {
            actName = `${parts[0]}, ${parts[1]}`;
        } else {
            actName = parts[0];
        }

        const timestamp = moment().format('YYYY-MM-DD HH:mm:ss');

        await this.connection.execute(
            'INSERT INTO acts (name, created_at, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id), updated_at=?',
            [actName, timestamp, timestamp, timestamp]
        );

        const [rows] = await this.connection.execute(
            'SELECT id FROM acts WHERE name = ?',
            [actName]
        );
        return rows.length ? rows[0].id : null;
    }

    async getOrCreateSection(sectionNumber) {
        if (!sectionNumber) return null;

        try {
            sectionNumber = String(sectionNumber).trim();

            await this.connection.execute(
                'INSERT IGNORE INTO sections (section_number) VALUES (?)',
                [sectionNumber]
            );

            const [rows] = await this.connection.execute(
                'SELECT id FROM sections WHERE section_number = ?',
                [sectionNumber]
            );
            return rows.length ? rows[0].id : null;

        } catch (error) {
            this.logger.error('Error in getOrCreateSection:', error);
            return null;
        }
    }

    async insertCase(caseDetails) {
        try {
            this.logger.debug('Case details:', JSON.stringify(caseDetails, null, 2));

            const [stateId, districtId] = await this.getOrCreateStateDistrict(caseDetails.cnrNumber);
            const courtId = await this.getOrCreateCourt("Munsiffss Court Kuthuparamba", stateId, districtId);
            const [courtHallId, judgeName] = await this.getOrCreateCourtHall(caseDetails.courtNumberAndJudge, courtId);
            const caseTypeId = await this.getOrCreateCaseType(caseDetails.caseType);

            // Parse dates
            const filingDate = this.parseDate(caseDetails.filingDate);
            const registrationDate = this.parseDate(caseDetails.registrationDate);
            const firstHearingDate = this.parseDate(caseDetails.firstHearingDate);
            const decisionDate = this.parseDate(caseDetails.decisionDate);
            const disposalDate = this.parseDate(caseDetails.disposalDate);

            // Insert case
            const [result] = await this.connection.execute(
                `INSERT INTO cases (
                    cnr_number, case_type_id, filing_number, filing_date,
                    registration_number, registration_date, case_status,
                    first_hearing_date, decision_date, disposal_date,
                    disposal_nature, court_hall_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                [
                    caseDetails.cnrNumber, caseTypeId, caseDetails.filingNumber,
                    filingDate, caseDetails.registrationNumber, registrationDate,
                    caseDetails.caseStatus, firstHearingDate, decisionDate,
                    disposalDate, caseDetails.disposalNature, courtHallId
                ]
            );

            const caseId = result.insertId;

            // Insert petitioner and advocate
            if (caseDetails.petitionerName) {
                const petitionerId = await this.getOrCreateLitigant(caseDetails.petitionerName);
                const petitionerAdvocateId = await this.getOrCreateAdvocate(caseDetails.petitionerAdvocate);

                await this.connection.execute(
                    `INSERT INTO case_litigants (
                        case_id, litigant_id, advocate_id, party_type,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, NOW(), NOW())`,
                    [caseId, petitionerId, petitionerAdvocateId, 'Petitioner']
                );
            }

            // Insert respondent and advocate
            if (caseDetails.respondentName) {
                const respondentId = await this.getOrCreateLitigant(caseDetails.respondentName);
                const respondentAdvocateId = await this.getOrCreateAdvocate(caseDetails.respondentAdvocate);

                await this.connection.execute(
                    `INSERT INTO case_litigants (
                        case_id, litigant_id, advocate_id, party_type,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, NOW(), NOW())`,
                    [caseId, respondentId, respondentAdvocateId, 'Respondent']
                );
            }

            // Insert acts and sections
            if (caseDetails.underActs) {
                const acts = caseDetails.underActs.split(',').map(act => act.trim());
                const sections = caseDetails.underSections ? 
                    caseDetails.underSections.split(',').map(section => section.trim()) : 
                    new Array(acts.length).fill(null);

                for (let i = 0; i < acts.length; i++) {
                    const actId = await this.getOrCreateAct(acts[i]);
                    if (actId) {
                        if (sections[i]) {
                            const sectionId = await this.getOrCreateSection(sections[i]);
                            if (sectionId) {
                                // Check if act-section combination already exists
                                const [existingRows] = await this.connection.execute(
                                    'SELECT id FROM act_sections WHERE act_id = ? AND section_id = ?',
                                    [actId, sectionId]
                                );

                                if (existingRows.length === 0) {
                                    await this.connection.execute(
                                        'INSERT INTO act_sections (act_id, section_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                                        [actId, sectionId]
                                    );
                                }
                            }
                        }

                        await this.connection.execute(
                            'INSERT IGNORE INTO case_acts (case_id, act_id, created_at, updated_at) VALUES (?, ?, NOW(), NOW())',
                            [caseId, actId]
                        );
                    }
                }
            }

            // Insert case history
            if (caseDetails.caseHistory) {
                for (const entry of caseDetails.caseHistory) {
                    const businessDate = this.parseDate(entry.businessDate);
                    const hearingDate = this.parseDate(entry.hearingDate);

                    await this.connection.execute(
                        `INSERT INTO case_history (
                            case_id, judge, business_date, hearing_date,
                            purpose, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                        [caseId, entry.judge, businessDate, hearingDate, entry.purpose]
                    );
                }
            }

            // Insert case transfers
            if (caseDetails.transferDetails) {
                for (const transfer of caseDetails.transferDetails) {
                    const transferDate = this.parseDate(transfer.transferDate);

                    await this.connection.execute(
                        `INSERT INTO case_transfers (
                            case_id, registration_number, transfer_date,
                            from_court, to_court, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
                        [
                            caseId, transfer.registrationNumber, transferDate,
                            transfer.fromCourt, transfer.toCourt
                        ]
                    );
                }
            }

            // Insert IA details
            if (caseDetails.iaDetails) {
                for (const ia of caseDetails.iaDetails) {
                    const dtFiling = this.parseDate(ia.dtFiling);
                    const dtReg = this.parseDate(ia.dtReg);

                    let iaPartyId = null;
                    let partyName = null;
                    if (ia.party) {
                        partyName = String(ia.party);
                        iaPartyId = await this.getOrCreateLitigant(partyName);
                    }

                    await this.connection.execute(
                        `INSERT INTO case_ias (
                            case_id, ia_no, classification, ia_status,
                            dt_filing, dt_reg, ia_party_id, party,
                            status, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
                        [
                            caseId, ia.iaNo, ia.classification || 'General',
                            ia.iaStatus, dtFiling, dtReg,
                            iaPartyId, partyName, ia.status || 'Online'
                        ]
                    );
                }
            }

            this.logger.info(`Successfully saved case ${caseDetails.cnrNumber} to database`);
            return caseId;

        } catch (error) {
            this.logger.error(`Failed to save case ${caseDetails.cnrNumber} to database:`, error);
            await this.connection.rollback();
            throw error;
        }
    }

    async cleanup() {
        if (this.connection) {
            await this.connection.end();
            this.connection = null;
            this.initialized = false;
        }
    }
} 