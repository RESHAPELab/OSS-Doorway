import mongoose from 'mongoose';

const QuestConfigSchema = new mongoose.Schema({
  groupId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  configData: {
    type: Object,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  source: {
    type: String,
    enum: ['file', 'database', 'migrated'],
    default: 'database'
  }
});

export default mongoose.model('QuestConfig', QuestConfigSchema);
