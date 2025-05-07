const reportService = require("../services/report.service");

exports.getAll = async (req, res) => {
  try {
    const reports = await reportService.getReportsByClient(req.user.clientId);
    res.json(reports);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
