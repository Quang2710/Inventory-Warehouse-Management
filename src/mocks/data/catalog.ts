/**
 * Dữ liệu mẫu tiếng Việt cho seed. Tên sản phẩm cố ý dùng tên chung (không thương hiệu thật).
 */

export interface CategorySeed {
  code: string;
  name: string;
  description: string;
  children?: readonly LeafCategorySeed[];
}

export interface VariantSeed {
  /** Hậu tố gắn vào tên sản phẩm, vd "túi 5kg". */
  label: string;
  unit: string;
  /** Hệ số giá so với giá cơ sở. */
  priceFactor: number;
}

export interface LeafCategorySeed {
  code: string;
  name: string;
  description: string;
  products: readonly string[];
  variants: readonly VariantSeed[];
  /** Khoảng giá nhập cơ sở (VND) cho biến thể có priceFactor = 1. */
  basePrice: readonly [number, number];
  trackExpiry: boolean;
  trackLot: boolean;
  /** Quản lý từng đơn vị theo số serial (mặc định không). */
  trackSerial?: boolean;
}

export const CATEGORY_TREE: readonly CategorySeed[] = [
  {
    code: 'FOOD',
    name: 'Thực phẩm',
    description: 'Thực phẩm khô, đóng gói',
    children: [
      {
        code: 'FOOD-RICE',
        name: 'Gạo & ngũ cốc',
        description: 'Gạo, ngũ cốc, yến mạch',
        products: [
          'Gạo ST25',
          'Gạo thơm Jasmine',
          'Gạo nếp cái hoa vàng',
          'Gạo lứt đỏ',
          'Yến mạch cán dẹt',
          'Ngũ cốc dinh dưỡng',
        ],
        variants: [
          { label: 'túi 1kg', unit: 'túi', priceFactor: 1 },
          { label: 'túi 5kg', unit: 'túi', priceFactor: 4.6 },
          { label: 'bao 25kg', unit: 'bao', priceFactor: 21.5 },
        ],
        basePrice: [28000, 65000],
        trackExpiry: true,
        trackLot: true,
      },
      {
        code: 'FOOD-NOODLE',
        name: 'Mì, bún & phở khô',
        description: 'Mì gói, bún khô, phở khô',
        products: [
          'Mì tôm chua cay',
          'Mì sườn hầm',
          'Phở bò ăn liền',
          'Bún gạo khô',
          'Miến dong',
          'Hủ tiếu ăn liền',
        ],
        variants: [
          { label: 'gói 75g', unit: 'gói', priceFactor: 1 },
          { label: 'thùng 30 gói', unit: 'thùng', priceFactor: 28 },
          { label: 'lốc 5 gói', unit: 'lốc', priceFactor: 4.8 },
        ],
        basePrice: [3800, 9000],
        trackExpiry: true,
        trackLot: false,
      },
      {
        code: 'FOOD-SPICE',
        name: 'Gia vị & nước chấm',
        description: 'Nước mắm, nước tương, hạt nêm',
        products: [
          'Nước mắm cá cơm 40 độ đạm',
          'Nước tương đậu nành',
          'Hạt nêm từ thịt',
          'Dầu ăn đậu nành',
          'Tương ớt',
          'Muối tôm Tây Ninh',
        ],
        variants: [
          { label: 'chai 500ml', unit: 'chai', priceFactor: 1 },
          { label: 'thùng 12 chai', unit: 'thùng', priceFactor: 11.4 },
        ],
        basePrice: [18000, 52000],
        trackExpiry: true,
        trackLot: true,
      },
      {
        code: 'FOOD-SNACK',
        name: 'Bánh kẹo',
        description: 'Bánh quy, kẹo, snack',
        products: [
          'Bánh quy bơ',
          'Bánh xốp kem',
          'Kẹo dẻo trái cây',
          'Snack khoai tây',
          'Bánh gạo nướng',
          'Hạt điều rang muối',
        ],
        variants: [
          { label: 'gói', unit: 'gói', priceFactor: 1 },
          { label: 'hộp quà', unit: 'hộp', priceFactor: 3.5 },
        ],
        basePrice: [12000, 85000],
        trackExpiry: true,
        trackLot: false,
      },
    ],
  },
  {
    code: 'BEV',
    name: 'Đồ uống',
    description: 'Nước giải khát, sữa, cà phê, trà',
    children: [
      {
        code: 'BEV-SOFT',
        name: 'Nước giải khát',
        description: 'Nước khoáng, nước ngọt, nước tăng lực',
        products: [
          'Nước khoáng thiên nhiên',
          'Nước tinh khiết',
          'Trà xanh đóng chai',
          'Nước tăng lực',
          'Nước ép cam',
          'Nước yến',
        ],
        variants: [
          { label: 'chai 500ml', unit: 'chai', priceFactor: 1 },
          { label: 'thùng 24 chai', unit: 'thùng', priceFactor: 22 },
          { label: 'lốc 6 chai', unit: 'lốc', priceFactor: 5.7 },
        ],
        basePrice: [4500, 14000],
        trackExpiry: true,
        trackLot: false,
      },
      {
        code: 'BEV-COFFEE',
        name: 'Cà phê & trà',
        description: 'Cà phê rang xay, hòa tan, trà túi lọc',
        products: [
          'Cà phê rang xay Robusta',
          'Cà phê rang xay Arabica',
          'Cà phê hòa tan 3in1',
          'Trà Thái Nguyên',
          'Trà ô long',
          'Trà atiso túi lọc',
        ],
        variants: [
          { label: 'gói 250g', unit: 'gói', priceFactor: 1 },
          { label: 'gói 500g', unit: 'gói', priceFactor: 1.9 },
          { label: 'gói 1kg', unit: 'gói', priceFactor: 3.6 },
        ],
        basePrice: [45000, 160000],
        trackExpiry: true,
        trackLot: true,
      },
      {
        code: 'BEV-MILK',
        name: 'Sữa & chế phẩm',
        description: 'Sữa tươi, sữa chua uống, sữa đặc',
        products: [
          'Sữa tươi tiệt trùng có đường',
          'Sữa tươi tiệt trùng không đường',
          'Sữa đậu nành',
          'Sữa chua uống',
          'Sữa đặc có đường',
          'Sữa hạt óc chó',
        ],
        variants: [
          { label: 'hộp 1L', unit: 'hộp', priceFactor: 1 },
          { label: 'thùng 12 hộp', unit: 'thùng', priceFactor: 11.2 },
          { label: 'hộp 180ml', unit: 'hộp', priceFactor: 0.24 },
        ],
        basePrice: [26000, 48000],
        trackExpiry: true,
        trackLot: true,
      },
    ],
  },
  {
    code: 'HPC',
    name: 'Hóa mỹ phẩm',
    description: 'Chăm sóc cá nhân và vệ sinh nhà cửa',
    children: [
      {
        code: 'HPC-PERSONAL',
        name: 'Chăm sóc cá nhân',
        description: 'Dầu gội, sữa tắm, kem đánh răng',
        products: [
          'Dầu gội thảo dược',
          'Sữa tắm hương hoa',
          'Kem đánh răng than hoạt tính',
          'Nước súc miệng',
          'Sữa rửa mặt',
          'Lăn khử mùi',
        ],
        variants: [
          { label: 'chai 180ml', unit: 'chai', priceFactor: 1 },
          { label: 'chai 650ml', unit: 'chai', priceFactor: 2.8 },
        ],
        basePrice: [32000, 95000],
        trackExpiry: true,
        trackLot: true,
      },
      {
        code: 'HPC-HOME',
        name: 'Vệ sinh nhà cửa',
        description: 'Nước giặt, nước rửa chén, lau sàn',
        products: [
          'Nước giặt đậm đặc',
          'Nước rửa chén hương chanh',
          'Nước lau sàn',
          'Nước xả vải',
          'Bột giặt',
          'Nước tẩy bồn cầu',
        ],
        variants: [
          { label: 'can 1kg', unit: 'can', priceFactor: 1 },
          { label: 'can 3.5kg', unit: 'can', priceFactor: 3.2 },
          { label: 'túi 2kg', unit: 'túi', priceFactor: 1.9 },
        ],
        basePrice: [28000, 75000],
        trackExpiry: false,
        trackLot: true,
      },
    ],
  },
  {
    code: 'ELEC',
    name: 'Điện tử & phụ kiện',
    description: 'Phụ kiện điện thoại, thiết bị âm thanh',
    children: [
      {
        code: 'ELEC-PHONE',
        name: 'Phụ kiện điện thoại',
        description: 'Cáp sạc, củ sạc, pin dự phòng, ốp lưng',
        products: [
          'Cáp sạc USB-C',
          'Củ sạc nhanh 20W',
          'Pin dự phòng 10000mAh',
          'Ốp lưng silicon',
          'Kính cường lực',
          'Giá đỡ điện thoại ô tô',
        ],
        variants: [
          { label: 'tiêu chuẩn', unit: 'cái', priceFactor: 1 },
          { label: 'cao cấp', unit: 'cái', priceFactor: 1.8 },
        ],
        basePrice: [45000, 320000],
        trackExpiry: false,
        trackLot: false,
      },
      {
        code: 'ELEC-AUDIO',
        name: 'Thiết bị âm thanh',
        description: 'Tai nghe, loa bluetooth',
        products: [
          'Tai nghe bluetooth nhét tai',
          'Tai nghe chụp tai',
          'Loa bluetooth mini',
          'Loa kéo karaoke',
          'Micro không dây',
        ],
        variants: [
          { label: 'màu đen', unit: 'cái', priceFactor: 1 },
          { label: 'màu trắng', unit: 'cái', priceFactor: 1 },
        ],
        basePrice: [180000, 1450000],
        trackExpiry: false,
        trackLot: false,
        trackSerial: true,
      },
    ],
  },
  {
    code: 'HOME',
    name: 'Gia dụng',
    description: 'Đồ dùng gia đình',
    children: [
      {
        code: 'HOME-KITCHEN',
        name: 'Đồ dùng nhà bếp',
        description: 'Nồi, chảo, hộp đựng thực phẩm',
        products: [
          'Chảo chống dính',
          'Nồi inox 3 đáy',
          'Bộ hộp đựng thực phẩm',
          'Dao làm bếp',
          'Thớt gỗ',
          'Bình giữ nhiệt',
        ],
        variants: [
          { label: 'cỡ vừa', unit: 'cái', priceFactor: 1 },
          { label: 'cỡ lớn', unit: 'cái', priceFactor: 1.45 },
        ],
        basePrice: [65000, 420000],
        trackExpiry: false,
        trackLot: false,
      },
    ],
  },
  {
    code: 'STAT',
    name: 'Văn phòng phẩm',
    description: 'Giấy, bút, dụng cụ văn phòng',
    children: [
      {
        code: 'STAT-PAPER',
        name: 'Giấy & sổ',
        description: 'Giấy in, sổ tay, giấy note',
        products: [
          'Giấy in A4 70gsm',
          'Giấy in A4 80gsm',
          'Sổ tay bìa da',
          'Giấy note vàng',
          'Vở kẻ ngang 200 trang',
        ],
        variants: [
          { label: 'đơn vị lẻ', unit: 'ram', priceFactor: 1 },
          { label: 'thùng 5', unit: 'thùng', priceFactor: 4.8 },
        ],
        basePrice: [15000, 78000],
        trackExpiry: false,
        trackLot: false,
      },
      {
        code: 'STAT-PEN',
        name: 'Bút & dụng cụ',
        description: 'Bút bi, bút dạ, kẹp, ghim',
        products: [
          'Bút bi xanh',
          'Bút gel đen',
          'Bút dạ quang',
          'Kẹp giấy',
          'Dập ghim',
          'Băng keo trong',
        ],
        variants: [
          { label: 'lẻ', unit: 'cái', priceFactor: 1 },
          { label: 'hộp 20', unit: 'hộp', priceFactor: 18 },
        ],
        basePrice: [3500, 45000],
        trackExpiry: false,
        trackLot: false,
      },
    ],
  },
];

export const WAREHOUSE_SEEDS = [
  {
    code: 'HN01',
    name: 'Kho Hà Nội',
    address: 'Lô CN3, KCN Ngọc Hồi, Thanh Trì, Hà Nội',
    phone: '02437000001',
    layout: { zones: 3, racksPerZone: 4, levels: 4, binsPerLevel: 3 },
  },
  {
    code: 'HCM01',
    name: 'Kho TP. Hồ Chí Minh',
    address: 'Đường số 7, KCN Tân Tạo, Bình Tân, TP. Hồ Chí Minh',
    phone: '02837000002',
    layout: { zones: 4, racksPerZone: 4, levels: 4, binsPerLevel: 3 },
  },
  {
    code: 'DN01',
    name: 'Kho Đà Nẵng',
    address: 'Đường số 3, KCN Hòa Khánh, Liên Chiểu, Đà Nẵng',
    phone: '02363700003',
    layout: { zones: 2, racksPerZone: 3, levels: 3, binsPerLevel: 4 },
  },
] as const;

/** Sức chứa mỗi ô theo khu (khu sau chứa hàng cồng kềnh hơn). */
export const ZONE_BIN_CAPACITY = [500, 600, 800, 800] as const;

export const PAYMENT_TERMS = [0, 15, 30, 45, 60] as const;

export const TRANSFER_NOTES = [
  'Điều chuyển bổ sung hàng bán chạy',
  'Cân đối tồn giữa các kho',
  'Chuẩn bị hàng cho chương trình khuyến mãi',
  'Chuyển hàng tồn lâu sang kho có sức mua tốt hơn',
] as const;

export const ISSUE_RECEIVERS_INTERNAL = [
  'Phòng Kinh doanh',
  'Phòng Marketing',
  'Bộ phận Trưng bày',
  'Cửa hàng số 1',
  'Cửa hàng số 2',
] as const;

export const REJECT_REASONS = [
  'Sai đơn giá so với đơn mua hàng',
  'Thiếu chứng từ kèm theo',
  'Số lượng không khớp biên bản giao nhận',
  'Chọn nhầm kho',
] as const;

export const CANCEL_REASONS = [
  'Nhà cung cấp thu hồi lô hàng',
  'Lập trùng chứng từ',
  'Khách hàng hủy đơn sau khi xuất',
  'Điều chỉnh theo biên bản đối chiếu',
] as const;
