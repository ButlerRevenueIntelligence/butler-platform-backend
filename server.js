// Butler & Co Revenue Intelligence Platform - Main API Server
// Version: 1.0.0

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 8080;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('combined'));

// JWT Secret (in production, use environment variable)
const JWT_SECRET = process.env.JWT_SECRET || 'butler-revenue-intelligence-secret-2026';

// In-memory data stores (replace with real database in production)
const users = new Map();
const clients = new Map();
const revenueRecords = new Map();
const integrations = new Map();
const insights = new Map();

// Seed some initial data
seedInitialData();

// ============================================================================
// MIDDLEWARE
// ============================================================================

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
}

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

app.post('/api/v1/auth/register', async (req, res) => {
    try {
        const { email, password, firstName, lastName, clientId } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        if (users.has(email)) {
            return res.status(409).json({ error: 'User already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const user = {
            id: userId,
            email,
            password: hashedPassword,
            firstName,
            lastName,
            clientId: clientId || `client-${Date.now()}`,
            role: 'admin',
            createdAt: new Date().toISOString()
        };

        users.set(email, user);

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, clientId: user.clientId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.status(201).json({
            access_token: token,
            token_type: 'Bearer',
            expires_in: 86400,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                clientId: user.clientId
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Registration failed', message: error.message });
    }
});

app.post('/api/v1/auth/token', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }

        const user = users.get(email);
        if (!user) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign(
            { userId: user.id, email: user.email, role: user.role, clientId: user.clientId },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            access_token: token,
            token_type: 'Bearer',
            expires_in: 86400,
            user: {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                role: user.role,
                clientId: user.clientId
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Login failed', message: error.message });
    }
});

// ============================================================================
// REVENUE ANALYTICS ENDPOINTS
// ============================================================================

app.get('/api/v1/revenue/summary', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date, granularity = 'daily' } = req.query;
        const clientId = req.user.clientId;

        const clientRecords = Array.from(revenueRecords.values())
            .filter(record => record.clientId === clientId);

        const totalRevenue = clientRecords.reduce((sum, r) => sum + r.amount, 0);
        const avgDailyRevenue = totalRevenue / Math.max(clientRecords.length, 1);

        // Calculate by source
        const bySource = {};
        clientRecords.forEach(record => {
            if (!bySource[record.source]) {
                bySource[record.source] = { revenue: 0, count: 0 };
            }
            bySource[record.source].revenue += record.amount;
            bySource[record.source].count++;
        });

        const bySourceArray = Object.entries(bySource).map(([source, data]) => ({
            source,
            revenue: data.revenue,
            percentage: (data.revenue / totalRevenue * 100).toFixed(1)
        }));

        // Generate time series data
        const byPeriod = generateTimeSeries(clientRecords, granularity);

        res.json({
            data: {
                total_revenue: totalRevenue,
                avg_daily_revenue: avgDailyRevenue,
                growth_rate: 0.34,
                mrr: totalRevenue * 0.85,
                arr: totalRevenue * 0.85 * 12,
                by_period: byPeriod,
                by_source: bySourceArray
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get revenue summary', message: error.message });
    }
});

app.get('/api/v1/revenue/forecast', authenticateToken, (req, res) => {
    try {
        const { periods = 6, granularity = 'monthly' } = req.query;
        const clientId = req.user.clientId;

        const clientRecords = Array.from(revenueRecords.values())
            .filter(record => record.clientId === clientId);

        const avgRevenue = clientRecords.reduce((sum, r) => sum + r.amount, 0) / Math.max(clientRecords.length, 1);
        const growthRate = 0.15; // 15% monthly growth

        const forecast = [];
        for (let i = 1; i <= periods; i++) {
            const predictedRevenue = avgRevenue * Math.pow(1 + growthRate, i);
            const confidence = Math.max(0.95 - (i * 0.05), 0.70);
            
            forecast.push({
                period: `2026-${String(i + 2).padStart(2, '0')}-01`,
                predicted_revenue: Math.round(predictedRevenue),
                lower_bound: Math.round(predictedRevenue * 0.85),
                upper_bound: Math.round(predictedRevenue * 1.15),
                confidence
            });
        }

        res.json({
            data: {
                model_version: 'v2.3.1',
                generated_at: new Date().toISOString(),
                forecast,
                assumptions: [
                    'Historical growth rate continues',
                    'No major market disruptions',
                    'Seasonal patterns from previous year apply'
                ],
                accuracy_metrics: {
                    mape: 8.2,
                    rmse: 12500
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Forecast generation failed', message: error.message });
    }
});

app.post('/api/v1/revenue/records', authenticateToken, (req, res) => {
    try {
        const { date, source, channel, amount, currency = 'USD', customer_id, metadata } = req.body;

        if (!date || !amount) {
            return res.status(400).json({ error: 'Date and amount required' });
        }

        const recordId = `record-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const record = {
            id: recordId,
            clientId: req.user.clientId,
            date,
            source: source || 'direct',
            channel: channel || 'direct',
            amount: parseFloat(amount),
            currency,
            customer_id,
            metadata,
            createdAt: new Date().toISOString()
        };

        revenueRecords.set(recordId, record);

        res.status(201).json(record);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create revenue record', message: error.message });
    }
});

// ============================================================================
// CLIENT MANAGEMENT ENDPOINTS
// ============================================================================

app.get('/api/v1/clients', authenticateToken, (req, res) => {
    try {
        const clientsArray = Array.from(clients.values());
        
        res.json({
            data: clientsArray,
            pagination: {
                total_count: clientsArray.length,
                has_more: false
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch clients', message: error.message });
    }
});

app.get('/api/v1/clients/:clientId', authenticateToken, (req, res) => {
    try {
        const client = clients.get(req.params.clientId);
        
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json(client);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch client', message: error.message });
    }
});

app.post('/api/v1/clients', authenticateToken, (req, res) => {
    try {
        const { company_name, domain, industry, plan_tier, primary_contact } = req.body;

        if (!company_name) {
            return res.status(400).json({ error: 'Company name required' });
        }

        const clientId = `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const client = {
            id: clientId,
            company_name,
            domain,
            industry,
            plan_tier: plan_tier || 'professional',
            mrr: 0,
            arr: 0,
            status: 'trial',
            health_score: 85,
            onboarding_completed: false,
            primary_contact,
            created_at: new Date().toISOString()
        };

        clients.set(clientId, client);

        res.status(201).json({
            ...client,
            onboarding_url: `https://app.butlerco.com/onboarding/${clientId}`,
            api_key: `bco_test_${Math.random().toString(36).substr(2, 24)}`
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create client', message: error.message });
    }
});

// ============================================================================
// AI INSIGHTS ENDPOINTS
// ============================================================================

app.get('/api/v1/insights/latest', authenticateToken, (req, res) => {
    try {
        const { limit = 10, type, min_confidence = 0 } = req.query;
        const clientId = req.user.clientId;

        let clientInsights = Array.from(insights.values())
            .filter(insight => insight.clientId === clientId);

        if (type) {
            clientInsights = clientInsights.filter(i => i.type === type);
        }

        clientInsights = clientInsights
            .filter(i => i.confidence >= min_confidence)
            .slice(0, parseInt(limit));

        res.json({ data: { insights: clientInsights } });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch insights', message: error.message });
    }
});

app.post('/api/v1/insights/generate', authenticateToken, (req, res) => {
    try {
        const { scope, target_id, focus_areas, time_window } = req.body;

        const jobId = `job-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Simulate async processing
        setTimeout(() => {
            const insight = {
                id: `insight-${Date.now()}`,
                clientId: req.user.clientId,
                type: 'opportunity',
                title: 'Growth Opportunity Detected',
                description: `Analysis of ${focus_areas.join(', ')} over ${time_window} reveals significant upside potential.`,
                confidence: 88,
                impact: 'high',
                generated_at: new Date().toISOString()
            };
            insights.set(insight.id, insight);
        }, 2000);

        res.status(202).json({
            job_id: jobId,
            status: 'processing',
            estimated_completion: new Date(Date.now() + 5000).toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to generate insights', message: error.message });
    }
});

// ============================================================================
// INTEGRATION ENDPOINTS
// ============================================================================

app.get('/api/v1/integrations', authenticateToken, (req, res) => {
    try {
        const clientId = req.user.clientId;
        const clientIntegrations = Array.from(integrations.values())
            .filter(int => int.clientId === clientId);

        res.json({ data: clientIntegrations });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch integrations', message: error.message });
    }
});

app.post('/api/v1/integrations/connect/:provider', authenticateToken, (req, res) => {
    try {
        const { provider } = req.params;
        const clientId = req.user.clientId;

        // Simulate OAuth flow
        const integrationId = `int-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const integration = {
            id: integrationId,
            clientId,
            provider,
            status: 'connected',
            connected_at: new Date().toISOString(),
            last_sync: new Date().toISOString()
        };

        integrations.set(integrationId, integration);

        res.status(201).json(integration);
    } catch (error) {
        res.status(500).json({ error: 'Integration connection failed', message: error.message });
    }
});

// ============================================================================
// ATTRIBUTION ENDPOINTS
// ============================================================================

app.post('/api/v1/attribution/calculate', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date, model = 'markov_chain' } = req.body;
        const clientId = req.user.clientId;

        const clientRecords = Array.from(revenueRecords.values())
            .filter(record => record.clientId === clientId);

        const totalRevenue = clientRecords.reduce((sum, r) => sum + r.amount, 0);

        const channels = [
            { channel: 'google_organic', attributed_revenue: totalRevenue * 0.38, conversions: 234, assists: 89 },
            { channel: 'linkedin_ads', attributed_revenue: totalRevenue * 0.29, conversions: 178, assists: 156 },
            { channel: 'direct', attributed_revenue: totalRevenue * 0.18, conversions: 124, assists: 45 },
            { channel: 'referral', attributed_revenue: totalRevenue * 0.15, conversions: 98, assists: 67 }
        ];

        channels.forEach(ch => {
            ch.attribution_percentage = ((ch.attributed_revenue / totalRevenue) * 100).toFixed(1);
        });

        res.json({
            data: {
                model,
                period: { start: start_date, end: end_date },
                total_revenue: totalRevenue,
                channels
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Attribution calculation failed', message: error.message });
    }
});

// ============================================================================
// SEO TRACKING ENDPOINTS
// ============================================================================

app.get('/api/v1/seo/rankings', authenticateToken, (req, res) => {
    try {
        const { start_date, end_date, keywords } = req.query;

        const sampleRankings = [
            {
                keyword: 'revenue intelligence',
                search_volume: 2400,
                current_position: 3,
                previous_position: 5,
                change: 2,
                url: 'https://example.com/revenue-intelligence',
                time_series: [
                    { date: '2026-01-01', position: 5 },
                    { date: '2026-01-15', position: 4 },
                    { date: '2026-02-01', position: 3 }
                ]
            },
            {
                keyword: 'marketing analytics',
                search_volume: 5400,
                current_position: 7,
                previous_position: 9,
                change: 2,
                url: 'https://example.com/analytics',
                time_series: [
                    { date: '2026-01-01', position: 9 },
                    { date: '2026-01-15', position: 8 },
                    { date: '2026-02-01', position: 7 }
                ]
            }
        ];

        res.json({
            data: {
                rankings: sampleRankings,
                summary: {
                    total_keywords: 267,
                    top_10_count: 82,
                    top_3_count: 24,
                    avg_position: 18.3,
                    avg_position_change: 1.2
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch rankings', message: error.message });
    }
});

// ============================================================================
// PREDICTIVE ANALYTICS ENDPOINTS
// ============================================================================

app.post('/api/v1/predict/churn', authenticateToken, (req, res) => {
    try {
        const { client_ids, threshold = 0.5 } = req.body;

        const predictions = Array.from(clients.values())
            .filter(c => !client_ids || client_ids.includes(c.id))
            .map(client => ({
                client_id: client.id,
                client_name: client.company_name,
                churn_probability: Math.random() * 0.8,
                risk_level: Math.random() > 0.7 ? 'high' : Math.random() > 0.4 ? 'medium' : 'low',
                primary_factors: ['declining_engagement', 'support_tickets_increase'],
                recommended_actions: ['Schedule executive review call', 'Offer dedicated success manager'],
                estimated_ltv_at_risk: Math.round(Math.random() * 200000)
            }));

        const highRisk = predictions.filter(p => p.risk_level === 'high').length;
        const mediumRisk = predictions.filter(p => p.risk_level === 'medium').length;
        const lowRisk = predictions.filter(p => p.risk_level === 'low').length;

        res.json({
            data: {
                model_version: 'churn-predictor-v2.1',
                prediction_date: new Date().toISOString(),
                predictions,
                summary: {
                    total_clients: predictions.length,
                    high_risk: highRisk,
                    medium_risk: mediumRisk,
                    low_risk: lowRisk,
                    total_ltv_at_risk: predictions.reduce((sum, p) => sum + p.estimated_ltv_at_risk, 0)
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Churn prediction failed', message: error.message });
    }
});

// ============================================================================
// HEALTH & STATUS ENDPOINTS
// ============================================================================

app.get('/health', (req, res) => {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        version: '1.0.0'
    });
});

app.get('/ready', (req, res) => {
    res.json({
        status: 'ready',
        timestamp: new Date().toISOString()
    });
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function seedInitialData() {
    // Create demo client
    const demoClientId = 'client-demo-001';
    clients.set(demoClientId, {
        id: demoClientId,
        company_name: 'TechCorp Industries',
        domain: 'techcorp.com',
        industry: 'IT Services',
        plan_tier: 'enterprise',
        mrr: 12500,
        arr: 150000,
        status: 'active',
        health_score: 95,
        onboarding_completed: true,
        created_at: '2025-06-15T00:00:00Z'
    });

    // Create demo user
    const demoEmail = 'demo@butlerco.com';
    bcrypt.hash('demo123', 10).then(hash => {
        users.set(demoEmail, {
            id: 'user-demo-001',
            email: demoEmail,
            password: hash,
            firstName: 'Demo',
            lastName: 'User',
            clientId: demoClientId,
            role: 'admin',
            createdAt: new Date().toISOString()
        });
    });

    // Seed revenue records
    const sources = ['organic', 'paid_ads', 'referral', 'direct'];
    for (let i = 0; i < 100; i++) {
        const recordId = `record-seed-${i}`;
        revenueRecords.set(recordId, {
            id: recordId,
            clientId: demoClientId,
            date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            source: sources[Math.floor(Math.random() * sources.length)],
            channel: 'google_organic',
            amount: Math.round(Math.random() * 5000 + 500),
            currency: 'USD',
            createdAt: new Date().toISOString()
        });
    }

    // Seed insights
    const insightTypes = ['opportunity', 'warning', 'success'];
    for (let i = 0; i < 5; i++) {
        const insightId = `insight-seed-${i}`;
        insights.set(insightId, {
            id: insightId,
            clientId: demoClientId,
            type: insightTypes[Math.floor(Math.random() * insightTypes.length)],
            title: `AI Insight ${i + 1}`,
            description: 'This is an AI-generated insight based on your data patterns.',
            confidence: Math.round(Math.random() * 20 + 75),
            impact: Math.random() > 0.5 ? 'high' : 'medium',
            generated_at: new Date().toISOString()
        });
    }

    console.log('✅ Initial data seeded');
    console.log('📧 Demo credentials: demo@butlerco.com / demo123');
}

function generateTimeSeries(records, granularity) {
    const periods = [];
    const now = new Date();
    
    for (let i = 5; i >= 0; i--) {
        const periodStart = new Date(now);
        periodStart.setMonth(periodStart.getMonth() - i);
        
        const revenue = records
            .filter(r => new Date(r.date) >= periodStart && new Date(r.date) < new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000))
            .reduce((sum, r) => sum + r.amount, 0);

        periods.push({
            period_start: periodStart.toISOString().split('T')[0],
            period_end: new Date(periodStart.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            revenue: Math.round(revenue),
            transactions: Math.round(revenue / 500)
        });
    }
    
    return periods;
}

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
    console.log('');
    console.log('🚀 Butler & Co Revenue Intelligence Platform API');
    console.log('================================================');
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`🌐 API URL: http://localhost:${PORT}`);
    console.log(`📊 Health: http://localhost:${PORT}/health`);
    console.log('');
    console.log('📧 Demo Login: demo@butlerco.com / demo123');
    console.log('');
    console.log('📖 Available Endpoints:');
    console.log('   POST /api/v1/auth/token - Login');
    console.log('   POST /api/v1/auth/register - Register');
    console.log('   GET  /api/v1/revenue/summary - Revenue data');
    console.log('   GET  /api/v1/revenue/forecast - Predictions');
    console.log('   GET  /api/v1/clients - List clients');
    console.log('   GET  /api/v1/insights/latest - AI insights');
    console.log('   GET  /api/v1/seo/rankings - SEO data');
    console.log('   POST /api/v1/predict/churn - Churn prediction');
    console.log('');
});

module.exports = app;
